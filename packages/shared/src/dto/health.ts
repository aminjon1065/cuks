/** Health check contracts (docs/01 §Health). */

import type { JobRunHealth, JobRunSummary } from '../metrics/index';

export type HealthState = 'ok' | 'degraded' | 'down';
export type DependencyState = 'up' | 'down';

export interface LivenessResult {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessResult {
  status: HealthState;
  dependencies: {
    postgres: DependencyState;
    redis: DependencyState;
    minio: DependencyState;
  };
}

// --- Admin health dashboard (docs/modules/16 §7, task 7.3) ---

/** Backing services probed for the admin "Здоровье" dashboard. */
export const HEALTH_SERVICES = [
  'postgres',
  'redis',
  'minio',
  'geoserver',
  'martin',
  'livekit',
  'clamav',
  'docflow_exchange',
] as const;
export type HealthServiceKey = (typeof HEALTH_SERVICES)[number];

export interface ServiceStatus {
  key: HealthServiceKey;
  state: DependencyState;
  /** Present when the probe is not configured (e.g. LiveKit URL unset) rather than truly down. */
  note?: 'not-configured';
}

/** BullMQ job counts for one queue. */
export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  completed: number;
}

export interface SchemaSize {
  schema: string;
  bytes: number;
}

export interface StorageStats {
  /** Whole database on disk (pg_database_size). */
  dbBytes: number;
  /** Largest schemas by total relation size. */
  dbSchemas: SchemaSize[];
  /** MinIO object bucket total + object count. */
  bucketBytes: number;
  bucketObjects: number;
  /** Free/total bytes of the api container's own filesystem — a proxy only; the host data disk is
   *  monitored by Uptime Kuma / the host (docs/08 §Мониторинг). Null if statfs is unavailable. */
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

/**
 * One scheduled sweep on the dashboard: its last recorded run plus the verdict on it
 * (plan этап 4 «метрики длительности/ошибок»).
 *
 * The verdict travels with the row instead of being derived on the client, because it is not
 * readable off the record: «26 hours ago» is late for the daily sweeps and perfectly normal for
 * the monthly one, and only `jobRunHealth` knows which is which.
 *
 * `error` is the message of whatever the processor threw, bounded on both sides of Redis: the
 * worker caps what it writes, and the api caps again on the way out, because a record stored
 * before either bound existed outlives the change. Bounded is not short — a driver exception can
 * still carry the failing statement inline — so it needs a wrapping block, not a fixed-width cell.
 * Raw exception text either way: a diagnostic line for an operator, never something to parse or
 * key off.
 */
export type JobRunStatus = JobRunSummary & { health: JobRunHealth };

export interface BackupStatus {
  /** ISO timestamp of the last successful backup run, or null if none recorded yet. */
  lastSuccessAt: string | null;
  snapshotId: string | null;
}

export interface HealthOverview {
  status: HealthState;
  services: ServiceStatus[];
  queues: QueueStats[];
  storage: StorageStats;
  backup: BackupStatus;
  /** Last recorded run of every metered scheduled sweep, one row per METERED_JOBS entry. */
  jobs: JobRunStatus[];
  /** Count of 5xx responses in the last 24h (rolling, from Redis metric buckets). */
  errors24h: number;
  generatedAt: string;
}

export interface QueueRetryResult {
  name: string;
  retried: number;
}
