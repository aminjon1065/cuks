import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
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

/** Postgres full-text search vector (docs/07 §Поиск: config `russian`, generated
 *  column + GIN). Stored generated columns keep it in sync with their source
 *  text automatically — no worker/app upkeep on rename/retag/re-extract. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

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
    // FTS over the node name (docs/modules/12 §3, docs/07). Only `name` goes in the
    // generated vector — `array_to_string` is STABLE (not immutable) so tags can't
    // live here; the search query matches `tags` separately. extracted_text has its
    // own vector on file_versions (extracted_tsv); search matches any of the three.
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(sql`to_tsvector('russian', "name")`),
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
    index('fs_nodes_search_tsv_idx').using('gin', t.searchTsv),
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
    // FTS over the extracted document text (docs/07). Generated from extracted_text
    // so re-extraction/restore keeps it current without any worker change.
    extractedTsv: tsvector('extracted_tsv').generatedAlwaysAs(
      sql`to_tsvector('russian', coalesce("extracted_text", ''))`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('file_versions_node_version_uq').on(t.nodeId, t.version),
    index('file_versions_node_idx').on(t.nodeId),
    index('file_versions_extracted_tsv_idx').using('gin', t.extractedTsv),
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

/**
 * file_links — internal share links (docs/modules/12 §3): "для всех
 * аутентифицированных, у кого есть ссылка" (no anonymous/external links in v1 —
 * closed network). Holding a valid, unexpired token lets an authenticated user
 * claim `viewer` access to the node. `onDelete: cascade` so a purged node's
 * links go with it (retention deletes fs_nodes directly — a restrict FK would
 * wedge the sweep, the class of bug found in 1.3's review).
 */
export const fileLinks = appSchema.table(
  'file_links',
  {
    id: primaryId(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => fsNodes.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    // null = never expires.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('file_links_token_uq').on(t.token),
    index('file_links_node_idx').on(t.nodeId),
  ],
);

/**
 * file_link_grants — records that a user accepted a specific internal link
 * (docs/modules/12 §3, task 1.4). Access from a link is enforced LIVE against
 * this table joined to `file_links` (not materialized as a permanent
 * resource_acl grant) so that revoking the link (cascade) or its expiry
 * immediately cuts the access it conferred. `viewer` level is implicit — links
 * only ever grant view/download. Both FKs cascade: deleting the link OR purging
 * the node removes the grant with no sweep needed.
 */
export const fileLinkGrants = appSchema.table(
  'file_link_grants',
  {
    id: primaryId(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => fileLinks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Denormalized from the link's node for a fast enforcement lookup (node +
    // ancestors) without a second join back to file_links.
    nodeId: uuid('node_id')
      .notNull()
      .references(() => fsNodes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('file_link_grants_link_user_uq').on(t.linkId, t.userId),
    index('file_link_grants_user_node_idx').on(t.userId, t.nodeId),
  ],
);
