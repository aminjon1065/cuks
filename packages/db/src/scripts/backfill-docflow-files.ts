import { config as loadEnv } from 'dotenv';

// Paths resolve from the package root (pnpm runs the script there), not from this file.
loadEnv({ path: ['.env', '../../.env'] });

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { DOCFLOW_FILES_ROOT_NAME } from '@cuks/shared';
import { createDb, type Database } from '../client';
import { documentFiles } from '../schema/docflow';
import { fsNodes } from '../schema/fs';

/**
 * Backfill for plan этап 1C: move the files of already-registered documents out of the
 * uploader's personal space into the docflow system tree (`system/docflow/<documentId>/`).
 *
 * Before 1C, attaching a file linked a node that stayed in the clerk's personal space —
 * the clerk could still delete, move or re-share the body of a registered document, and
 * other participants had no ACL on it at all. New attachments are adopted at attach time;
 * this walks the rows that predate that.
 *
 * Safe to re-run: it only touches links whose node is still outside the tree, so a second
 * run is a no-op. It commits one document at a time, so an interrupted run resumes simply
 * by being started again — there is no cursor to keep.
 *
 *   pnpm --filter @cuks/db backfill:docflow-files -- --dry-run
 *   pnpm --filter @cuks/db backfill:docflow-files -- --batch=200
 */
interface Options {
  dryRun: boolean;
  batch: number;
}

function parseArgs(argv: string[]): Options {
  const batchArg = argv.find((a) => a.startsWith('--batch='));
  const batch = batchArg ? Number(batchArg.slice('--batch='.length)) : 100;
  if (!Number.isInteger(batch) || batch < 1) {
    throw new Error(`--batch must be a positive integer, got "${batchArg}"`);
  }
  return { dryRun: argv.includes('--dry-run'), batch };
}

/** Document ids that still own at least one file outside the docflow system tree. */
async function pendingDocuments(db: Database, limit: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ documentId: documentFiles.documentId })
    .from(documentFiles)
    .innerJoin(fsNodes, eq(fsNodes.id, documentFiles.fileId))
    .where(and(ne(fsNodes.space, 'system'), isNull(fsNodes.deletedAt)))
    .limit(limit);
  return rows.map((r) => r.documentId);
}

/** Find-or-create one system-space folder (mirrors DocflowFilesService.ensureFolder). */
async function ensureFolder(
  tx: Database,
  parentId: string | null,
  name: string,
): Promise<{ id: string; path: string }> {
  const where = and(
    eq(fsNodes.space, 'system'),
    eq(fsNodes.kind, 'folder'),
    eq(fsNodes.name, name),
    parentId ? eq(fsNodes.parentId, parentId) : isNull(fsNodes.parentId),
    isNull(fsNodes.deletedAt),
  );
  const [found] = await tx
    .select({ id: fsNodes.id, path: fsNodes.path })
    .from(fsNodes)
    .where(where)
    .limit(1);
  if (found) return found;

  let parentPath: string | null = null;
  if (parentId) {
    const [parent] = await tx
      .select({ path: fsNodes.path })
      .from(fsNodes)
      .where(eq(fsNodes.id, parentId))
      .limit(1);
    if (!parent) throw new Error(`parent folder ${parentId} disappeared`);
    parentPath = parent.path;
  }
  const [created] = await tx
    .insert(fsNodes)
    .values({ kind: 'folder', name, space: 'system', parentId, path: 'pending' })
    .returning({ id: fsNodes.id });
  if (!created) throw new Error('system folder insert did not return an id');
  const path = parentPath ? `${parentPath}.${created.id}` : created.id;
  await tx.update(fsNodes).set({ path }).where(eq(fsNodes.id, created.id));
  return { id: created.id, path };
}

/** Adopt every stray file of one document. Returns how many nodes moved. */
async function adoptDocument(db: Database, documentId: string, dryRun: boolean): Promise<number> {
  const strays = await db
    .select({ id: fsNodes.id, name: fsNodes.name, space: fsNodes.space })
    .from(documentFiles)
    .innerJoin(fsNodes, eq(fsNodes.id, documentFiles.fileId))
    .where(
      and(
        eq(documentFiles.documentId, documentId),
        ne(fsNodes.space, 'system'),
        isNull(fsNodes.deletedAt),
      ),
    );
  if (strays.length === 0) return 0;
  if (dryRun) {
    for (const s of strays) console.log(`  would move ${s.space}/${s.name} (${s.id})`);
    return strays.length;
  }
  await db.transaction(async (tx) => {
    const root = await ensureFolder(tx, null, DOCFLOW_FILES_ROOT_NAME);
    const folder = await ensureFolder(tx, root.id, documentId);
    for (const stray of strays) {
      await tx
        .update(fsNodes)
        .set({
          space: 'system',
          parentId: folder.id,
          path: `${folder.path}.${stray.id}`,
          ownerUserId: null,
          ownerOrgUnitId: null,
        })
        .where(eq(fsNodes.id, stray.id));
    }
  });
  return strays.length;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for the docflow-files backfill');
  const { dryRun, batch } = parseArgs(process.argv.slice(2));
  const prefix = dryRun ? '[dry-run] ' : '';

  const { db, pool } = createDb(url);
  try {
    const total = Number(
      (
        await db.execute<{ total: number }>(sql`
          select count(distinct df.document_id)::int as total
          from app.document_files df
          join app.fs_nodes n on n.id = df.file_id
          where n.space <> 'system' and n.deleted_at is null
        `)
      ).rows[0]?.total ?? 0,
    );
    console.log(`${prefix}documents with files outside the docflow tree: ${total}`);

    let documents = 0;
    let moved = 0;
    for (;;) {
      const ids = await pendingDocuments(db, batch);
      if (ids.length === 0) break;
      for (const id of ids) {
        const n = await adoptDocument(db, id, dryRun);
        if (n > 0) {
          documents += 1;
          moved += n;
          console.log(`${prefix}document ${id}: ${n} file(s)`);
        }
      }
      // A dry run changes nothing, so the same batch would come back forever.
      if (dryRun) break;
    }
    console.log(`${prefix}done: ${moved} file(s) across ${documents} document(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
