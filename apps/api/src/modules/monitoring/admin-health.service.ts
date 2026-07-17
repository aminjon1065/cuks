import { connect } from 'node:net';
import { statfs } from 'node:fs/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { backupRuns, type Database } from '@cuks/db';
import {
  HEALTH_SERVICES,
  type DependencyState,
  type HealthOverview,
  type HealthServiceKey,
  type HealthState,
  type SchemaSize,
  type ServiceStatus,
  type StorageStats,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { ConfigService } from '../../config/config.service';
import { StorageService } from '../../common/storage/storage.service';
import { HealthService } from '../health/health.service';
import { MetricsService } from './metrics.service';
import { QueueStatsService } from './queue-stats.service';

const PROBE_TIMEOUT_MS = 2000;
const STORAGE_CACHE_MS = 60_000;

/**
 * Aggregates the admin "Здоровье" dashboard (docs/modules/16 §7): backing-service probes, storage sizes,
 * BullMQ queue depth, last backup, and the 24h error count. Explicitly NOT a replacement for real
 * monitoring (Uptime Kuma / docs/08) — a single at-a-glance view. Storage sizes (DB + bucket listing) are
 * cached briefly so the polling dashboard doesn't hammer Postgres/MinIO.
 */
@Injectable()
export class AdminHealthService {
  private readonly logger = new Logger(AdminHealthService.name);
  private storageCache: { at: number; value: StorageStats } | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly health: HealthService,
    private readonly queues: QueueStatsService,
    private readonly metrics: MetricsService,
  ) {}

  async overview(): Promise<HealthOverview> {
    const [services, storage, queues, errors24h, backup] = await Promise.all([
      this.probeServices(),
      this.storageStats(),
      this.queues.stats(),
      this.metrics.errorsLast24h(),
      this.lastBackup(),
    ]);
    return {
      status: aggregate(services),
      services,
      queues,
      storage,
      backup,
      errors24h,
      generatedAt: new Date().toISOString(),
    };
  }

  retryQueue(name: string): Promise<number | null> {
    return this.queues.retryFailed(name);
  }

  // --- Service probes ---

  private async probeServices(): Promise<ServiceStatus[]> {
    const core = await this.health.readiness(); // postgres, redis, minio
    const [geoserver, martin, livekit, clamav] = await Promise.all([
      this.probeGeoserver(),
      this.probeMartin(),
      this.probeLivekit(),
      this.probeClamav(),
    ]);
    const map: Record<HealthServiceKey, ServiceStatus> = {
      postgres: { key: 'postgres', state: core.dependencies.postgres },
      redis: { key: 'redis', state: core.dependencies.redis },
      minio: { key: 'minio', state: core.dependencies.minio },
      geoserver,
      martin,
      livekit,
      clamav,
    };
    return HEALTH_SERVICES.map((k) => map[k]);
  }

  private async probeGeoserver(): Promise<ServiceStatus> {
    const url = this.config.get('GEOSERVER_URL');
    if (!url) return { key: 'geoserver', state: 'down', note: 'not-configured' };
    // Any HTTP response (even 403 on the web UI) means the servlet is up.
    return { key: 'geoserver', state: await probeHttp(`${trimSlash(url)}/web/`, true) };
  }

  private async probeMartin(): Promise<ServiceStatus> {
    const url = this.config.get('MARTIN_URL');
    if (!url) return { key: 'martin', state: 'down', note: 'not-configured' };
    return { key: 'martin', state: await probeHttp(`${trimSlash(url)}/health`, false) };
  }

  private async probeLivekit(): Promise<ServiceStatus> {
    const url = this.config.get('LIVEKIT_INTERNAL_URL') ?? this.config.get('LIVEKIT_URL');
    if (!url) return { key: 'livekit', state: 'down', note: 'not-configured' };
    const http = url.replace(/^ws(s?):\/\//, 'http$1://');
    // LiveKit's HTTP root answers (200/404) when the SFU is up; any response = up.
    return { key: 'livekit', state: await probeHttp(http, true) };
  }

  private async probeClamav(): Promise<ServiceStatus> {
    const host = this.config.get('CLAMAV_HOST');
    const port = this.config.get('CLAMAV_PORT');
    return { key: 'clamav', state: await probeTcp(host, port) };
  }

  // --- Storage sizes (cached) ---

  private async storageStats(): Promise<StorageStats> {
    const now = Date.now();
    if (this.storageCache && now - this.storageCache.at < STORAGE_CACHE_MS) {
      return this.storageCache.value;
    }
    const [db, bucket, disk] = await Promise.all([
      this.dbSizes(),
      this.bucketSize(),
      this.diskFree(),
    ]);
    const value: StorageStats = {
      dbBytes: db.total,
      dbSchemas: db.schemas,
      bucketBytes: bucket.bytes,
      bucketObjects: bucket.objects,
      diskFreeBytes: disk.free,
      diskTotalBytes: disk.total,
    };
    this.storageCache = { at: now, value };
    return value;
  }

  private async dbSizes(): Promise<{ total: number; schemas: SchemaSize[] }> {
    try {
      const totalRes = await this.db.execute<{ bytes: string }>(
        sql`select pg_database_size(current_database()) as bytes`,
      );
      const schemaRes = await this.db.execute<{ schema: string; bytes: string }>(sql`
        select n.nspname as schema, sum(pg_total_relation_size(c.oid))::bigint as bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'm')
          and n.nspname not in ('pg_catalog', 'information_schema')
        group by n.nspname order by bytes desc limit 8
      `);
      return {
        total: Number(rows<{ bytes: string }>(totalRes)[0]?.bytes ?? 0),
        schemas: rows<{ schema: string; bytes: string }>(schemaRes).map((r) => ({
          schema: r.schema,
          bytes: Number(r.bytes),
        })),
      };
    } catch (err) {
      this.logger.warn({ err }, 'db size query failed');
      return { total: 0, schemas: [] };
    }
  }

  private async bucketSize(): Promise<{ bytes: number; objects: number }> {
    try {
      return await this.storage.bucketSize();
    } catch (err) {
      this.logger.warn({ err }, 'bucket size unavailable');
      return { bytes: 0, objects: 0 };
    }
  }

  private async diskFree(): Promise<{ free: number | null; total: number | null }> {
    try {
      const fs = await statfs('/');
      return { free: fs.bsize * fs.bavail, total: fs.bsize * fs.blocks };
    } catch {
      return { free: null, total: null };
    }
  }

  private async lastBackup(): Promise<HealthOverview['backup']> {
    try {
      const [row] = await this.db
        .select({ finishedAt: backupRuns.finishedAt, snapshotId: backupRuns.snapshotId })
        .from(backupRuns)
        .orderBy(desc(backupRuns.finishedAt))
        .limit(1);
      return {
        lastSuccessAt: row ? row.finishedAt.toISOString() : null,
        snapshotId: row?.snapshotId ?? null,
      };
    } catch (err) {
      this.logger.warn({ err }, 'backup marker query failed');
      return { lastSuccessAt: null, snapshotId: null };
    }
  }
}

/** ok when every CONFIGURED service is up; down when all are down; otherwise degraded. Exported for tests. */
export function aggregate(services: ServiceStatus[]): HealthState {
  const configured = services.filter((s) => s.note !== 'not-configured');
  if (configured.length === 0) return 'ok';
  const up = configured.filter((s) => s.state === 'up').length;
  if (up === configured.length) return 'ok';
  if (up === 0) return 'down';
  return 'degraded';
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function probeHttp(url: string, acceptAnyStatus: boolean): Promise<DependencyState> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return acceptAnyStatus || res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

function probeTcp(host: string, port: number): Promise<DependencyState> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (state: DependencyState) => {
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => done('up'));
    socket.once('timeout', () => done('down'));
    socket.once('error', () => done('down'));
  });
}

/** drizzle's execute returns a driver-shaped result; node-postgres puts rows on `.rows`. */
function rows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && 'rows' in res) return (res as { rows: T[] }).rows;
  return [];
}
