import { bigint, index, text, timestamp } from 'drizzle-orm/pg-core';
import { appSchema, createdAt, primaryId } from './_shared';

/**
 * One row per successful backup run (docs/modules/16 §7, task 7.3). Written by
 * infra/scripts/backup.sh (raw psql — it supplies its own id, so the app never
 * inserts here) after a restic snapshot completes, and read by the admin health
 * dashboard to show the last successful backup. Old rows are pruned by the
 * retention sweep is not needed — one small row per day is negligible.
 */
export const backupRuns = appSchema.table(
  'backup_runs',
  {
    id: primaryId(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).defaultNow().notNull(),
    /** restic short snapshot id, if the script captured it. */
    snapshotId: text('snapshot_id'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [index('backup_runs_finished_at_idx').on(t.finishedAt.desc())],
);
