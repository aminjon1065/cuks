import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AV_STATUSES, FS_NODE_KINDS, FS_SPACES } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { orgUnits } from './org';
import { users } from './users';

/**
 * fs_nodes — unified folder/file tree (docs/modules/12 §3), materialized `path`
 * like `org_units`. `current_version_id` has no FK: it would form a cycle with
 * file_versions.node_id → fs_nodes.id (same precedent as org_units.head_position_id).
 */
export const fsNodes = appSchema.table(
  'fs_nodes',
  {
    id: primaryId(),
    parentId: uuid('parent_id'),
    kind: text('kind', { enum: FS_NODE_KINDS }).notNull(),
    name: text('name').notNull(),
    space: text('space', { enum: FS_SPACES }).notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
    ownerOrgUnitId: uuid('owner_org_unit_id').references(() => orgUnits.id, {
      onDelete: 'restrict',
    }),
    currentVersionId: uuid('current_version_id'),
    // Mirrors the current version's size for a file (kept in sync on every version
    // change) — the source of truth for quota accounting. 0/unused for folders (no
    // recursive rollup — docs/plan/STATUS.md 1.2 decision).
    sizeCached: bigint('size_cached', { mode: 'number' }).notNull().default(0),
    mime: text('mime'),
    tags: text('tags').array().notNull().default([]),
    starredBy: uuid('starred_by').array().notNull().default([]),
    path: text('path').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'fs_nodes_parent_fk',
    }).onDelete('restrict'),
    index('fs_nodes_parent_idx').on(t.parentId),
    index('fs_nodes_path_idx').on(t.path.op('text_pattern_ops')),
    index('fs_nodes_owner_user_idx').on(t.ownerUserId),
    index('fs_nodes_owner_org_unit_idx').on(t.ownerOrgUnitId),
    // At most one lazily-provisioned root folder per org unit (docs/modules/12 §2)
    // — a DB backstop against a create-if-missing race between concurrent requests.
    uniqueIndex('fs_nodes_org_root_uq')
      .on(t.ownerOrgUnitId)
      .where(sql`${t.parentId} is null and ${t.space} = 'org'`),
    check('fs_nodes_kind_chk', sql`${t.kind} in ('folder', 'file')`),
    check('fs_nodes_space_chk', sql`${t.space} in ('personal', 'org', 'system')`),
  ],
);

/** file_versions — history of a file node's content (docs/modules/12 §3). */
export const fileVersions = appSchema.table(
  'file_versions',
  {
    id: primaryId(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => fsNodes.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    avStatus: text('av_status', { enum: AV_STATUSES }).notNull().default('pending'),
    // Populated by the worker's text-extract job (phase 1.3) for FTS; null until then.
    extractedText: text('extracted_text'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('file_versions_node_version_uq').on(t.nodeId, t.version),
    index('file_versions_node_idx').on(t.nodeId),
    check('file_versions_av_status_chk', sql`${t.avStatus} in ('pending', 'clean', 'infected')`),
  ],
);

/**
 * file_uploads — staging row for an in-progress presigned multipart upload
 * (docs/modules/12 §4). Bridges a StorageService session to the eventual
 * fs_node + file_version created at `/complete`; deleted on complete/abort.
 * `expiresAt` lets the phase-1.3 retention job sweep abandoned uploads
 * ("temp-uploads 24 ч").
 */
export const fileUploads = appSchema.table(
  'file_uploads',
  {
    id: primaryId(),
    storageKey: text('storage_key').notNull(),
    s3UploadId: text('s3_upload_id').notNull(),
    // The folder this upload will land in; null only for a personal-space root upload.
    parentId: uuid('parent_id').references(() => fsNodes.id, { onDelete: 'restrict' }),
    // Set when this upload is a new version of an existing file node (docs/modules/12
    // §4: "загрузка того же имени → новая версия"), rather than creating a new node.
    targetNodeId: uuid('target_node_id').references(() => fsNodes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    space: text('space', { enum: FS_SPACES }).notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
    ownerOrgUnitId: uuid('owner_org_unit_id').references(() => orgUnits.id, {
      onDelete: 'restrict',
    }),
    declaredSize: bigint('declared_size', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('file_uploads_space_chk', sql`${t.space} in ('personal', 'org', 'system')`)],
);
