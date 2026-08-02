import { connect } from 'node:net';
import { statfs } from 'node:fs/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { backupRuns, type Database } from '@cuks/db';
import {
  HEALTH_SERVICES,
  METERED_JOBS,
  jobRunHealth,
  truncateSafe,
  type DependencyState,
  type HealthOverview,
  type HealthServiceKey,
  type HealthState,
  type JobRunRecord,
  type JobRunStatus,
  type MeteredJob,
  type SchemaSize,
  type ServiceStatus,
  type StorageStats,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { ConfigService } from '../../config/config.service';
import { StorageService } from '../../common/storage/storage.service';
import { HealthService } from '../health/health.service';
import { MetricsService } from './metrics.service';
import { ExchangeRegistryService } from '../docflow/exchange/exchange-registry.service';
import { QueueStatsService } from './queue-stats.service';

const PROBE_TIMEOUT_MS = 2000;
const STORAGE_CACHE_MS = 60_000;

/**
 * Cap on the error text of a job run as it leaves the api.
 *
 * Same 2 000 chars the deadline and notification outboxes already cap their `last_error` at, so a
 * message that survives one path survives the other.
 */
const MAX_ERROR_LENGTH = 2_000;

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
    private readonly exchange: ExchangeRegistryService,
  ) {}

  async overview(): Promise<HealthOverview> {
    const [services, storage, queues, errors24h, backup, jobRuns] = await Promise.all([
      this.probeServices(),
      this.storageStats(),
      this.queues.stats(),
      this.metrics.errorsLast24h(),
      this.lastBackup(),
      this.metrics.jobRuns(),
    ]);
    const now = new Date();
    const jobs = jobStatuses(jobRuns, now);
    return {
      status: withJobs(aggregate(services), jobs),
      services,
      queues,
      storage,
      backup,
      jobs,
      errors24h,
      generatedAt: now.toISOString(),
    };
  }

  retryQueue(name: string): Promise<number | null> {
    return this.queues.retryFailed(name);
  }

  // --- Service probes ---

  private async probeServices(): Promise<ServiceStatus[]> {
    const core = await this.health.readiness(); // postgres, redis, minio
    const [geoserver, martin, livekit, clamav, docflowExchange] = await Promise.all([
      this.probeGeoserver(),
      this.probeMartin(),
      this.probeLivekit(),
      this.probeClamav(),
      this.probeDocflowExchange(),
    ]);
    const map: Record<HealthServiceKey, ServiceStatus> = {
      postgres: { key: 'postgres', state: core.dependencies.postgres },
      redis: { key: 'redis', state: core.dependencies.redis },
      minio: { key: 'minio', state: core.dependencies.minio },
      geoserver,
      martin,
      livekit,
      clamav,
      docflow_exchange: docflowExchange,
    };
    return HEALTH_SERVICES.map((k) => map[k]);
  }

  /**
   * Document exchange (plan этап 10 «Admin health/status без показа секретов»).
   *
   * The probe is delegated to the adapter, which knows what «reachable» means for its own
   * transport, and only a state crosses back — never a path, a host or a credential. Not
   * configured is the SHIPPED state and reads as such: `not-configured` is excluded from the
   * overall status, so an installation with no transport is not permanently «unhealthy».
   */
  private async probeDocflowExchange(): Promise<ServiceStatus> {
    if (!this.exchange.isConfigured) {
      return { key: 'docflow_exchange', state: 'down', note: 'not-configured' };
    }
    const statuses = await this.exchange.status();
    const allReachable = statuses.every((s) => s.reachable);
    return { key: 'docflow_exchange', state: allReachable ? 'up' : 'down' };
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

/**
 * Flatten the last-run records into dashboard rows, in METERED_JOBS order. Exported for tests.
 *
 * A job with no record is not omitted: «нет данных» about a sweep that is supposed to run every
 * night is itself the finding, and a missing row would simply be invisible on the screen.
 */
export function jobStatuses(
  runs: Record<MeteredJob, JobRunRecord | null>,
  now: Date = new Date(),
): JobRunStatus[] {
  return METERED_JOBS.map((job): JobRunStatus => {
    const record = runs[job];
    const health = jobRunHealth(job, record, now);
    return record
      ? { job, health, ran: true, ...record, error: cappedError(record.error) }
      : {
          job,
          health,
          ran: false,
          finishedAt: null,
          durationMs: null,
          ok: null,
          counts: null,
          error: null,
        };
  });
}

/**
 * Bound the stored error text on the way out.
 *
 * The record carries whatever the processor threw, and that is not a sentence: a driver exception
 * arrives with the failing statement inlined, a fetch failure with the whole cause chain. Unbounded,
 * it goes onto a JSON response the dashboard polls every few seconds and into a table cell with no
 * room for it.
 *
 * Capping at the write is not enough on its own, which is why the bound is repeated here rather
 * than assumed: a record already in Redis outlives any change to the writer by up to
 * `JOB_RUN_TTL_SECONDS` (45 days), and the api and the worker are separate deployables that roll
 * independently. So this is a backstop over a value the api did not produce — an older format, a
 * hand-edited key, a worker that has not rolled yet — and it is deliberately WIDER than the
 * worker's own cap (500 chars) rather than equal to it: anything the current writer stored is
 * already shorter and passes through untouched, so nothing is cut twice, and a backstop pinned to
 * the writer's number would have to be changed in lockstep across two deployables to keep meaning
 * the same thing.
 *
 * `truncateSafe`, not `slice`, so a message ending in an emoji does not leave a lone surrogate.
 */
function cappedError(error: string | null): string | null {
  return error === null ? null : truncateSafe(error, MAX_ERROR_LENGTH);
}

/**
 * Fold the sweeps into the overall status. Exported for tests.
 *
 * A sweep that threw (`failed`) or is overdue against its OWN schedule (`stale`) makes the
 * platform degraded — that is exactly the case an operator currently cannot see. Two deliberate
 * limits:
 *
 * - never worse than `degraded`: the sweeps are background bookkeeping, and a stuck retention run
 *   does not mean the platform stopped serving. `down` stays reserved for the backing services.
 * - `unknown` does not degrade anything. Nothing recorded means a fresh install before the first
 *   nightly run, a flushed Redis, or Redis being unreachable — and in that last case the redis
 *   probe is already red. Painting a new installation permanently yellow would teach people to
 *   ignore the colour.
 *
 * Treating `unknown` as benign is only defensible while a job that HAS run cannot arrive back at
 * it without being shown as broken first. That is not a property of this function — it is
 * `JOB_RUN_TTL_COVERS_STALENESS`: the record's TTL outlives every threshold in
 * `JOB_STALE_AFTER_HOURS`, so a sweep that stops running is still holding its last record when it
 * crosses its own deadline, and the row turns `stale` — degrading and visible — instead of
 * expiring quietly back into the benign label. The order is what the invariant buys, not
 * permanence: the row stays `stale` for the rest of the record's life (the TTL minus the
 * threshold — twelve days for the monthly sweep, about six weeks for the daily ones) and reads
 * `unknown` again once the key does expire. So `unknown` means «no run is on record», which covers
 * both a fresh install and a sweep dead for longer than the TTL; `stale` is the state that carries
 * the «did not run» signal, and every job passes through it on the way.
 *
 * Cut the TTL below the longest threshold and this silently inverts for exactly the job it matters
 * for: the monthly `audit-maintenance` record would expire before its 33-day deadline, so a dead
 * sweep would go `ok` → `unknown` — indistinguishable from a fresh install, and by the rule above
 * degrading nothing. That was the shipped behaviour of the first version (8-day TTL) and is why
 * the invariant is a named export rather than a remark; `admin-health.service.spec.ts` asserts it
 * here, at the reader that depends on it.
 */
export function withJobs(base: HealthState, jobs: JobRunStatus[]): HealthState {
  if (base === 'down') return 'down';
  const troubled = jobs.some((j) => j.health === 'failed' || j.health === 'stale');
  return troubled ? 'degraded' : base;
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
