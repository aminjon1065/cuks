/**
 * BullMQ queue contract (docs/01 §Фоновые задачи). Queue names + job payloads are
 * shared so the api (producer) and worker (consumer) can't drift. Extended per
 * feature phase (av-scan, preview, geo, … land with their modules).
 */
export const QUEUE = {
  email: 'email',
  deadlines: 'deadlines',
  auditMaintenance: 'audit-maintenance',
  avScan: 'av-scan',
  preview: 'preview',
  textExtract: 'text-extract',
  retention: 'retention',
  geoImport: 'geo-import',
  geoExport: 'geo-export',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** `email` queue — one outgoing message (docs/02 §Email: nodemailer → SMTP). */
export interface EmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Shared by `av-scan`/`preview`/`text-extract` (docs/modules/12 §8) — identifies
 *  the file_version to process; the worker fetches its own copy of the bytes. */
export interface FileVersionJobData {
  nodeId: string;
  versionId: string;
  storageKey: string;
  mime: string;
}

/** `geo-import` queue (docs/modules/10 §6) — the record carries everything else
 *  (source object, options), so the job only needs to name it. */
export interface GeoImportJobData {
  importId: string;
}

/** `geo-export` queue (docs/modules/10 §6). */
export interface GeoExportJobData {
  exportId: string;
}

/**
 * Geo jobs are long (a shapefile of 100k features, a GPKG write) and are not
 * idempotent to re-run blindly — a retry would import the same features twice.
 * They run once and report their failure in the record's log instead.
 */
export const GEO_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 500,
};

/**
 * Default job options: a few retries with exponential backoff, and bounded
 * retention of finished jobs so Redis doesn't grow unbounded (docs/01 §73).
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};
