/** Health check contracts (docs/01 §Health). */

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
  /** Count of 5xx responses in the last 24h (rolling, from Redis metric buckets). */
  errors24h: number;
  generatedAt: string;
}

export interface QueueRetryResult {
  name: string;
  retried: number;
}
