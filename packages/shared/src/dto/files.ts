import { z } from 'zod';
import { PREVIEW_SIZES } from '../constants/index';
import { ACL_LEVELS, ACL_SUBJECT_TYPES, FS_NODE_KINDS, FS_SPACES } from '../enums/index';
import type { AclLevel, AclSubjectType, AvStatus } from '../enums/index';

const uuid = () => z.string().uuid();

export const previewQuerySchema = z.object({
  size: z.enum(Object.keys(PREVIEW_SIZES) as [string, ...string[]]).default('medium'),
});
export type PreviewQuery = z.infer<typeof previewQuerySchema>;

export interface FsNodeDto {
  id: string;
  parentId: string | null;
  kind: string;
  name: string;
  space: string;
  ownerUserId: string | null;
  ownerOrgUnitId: string | null;
  currentVersionId: string | null;
  /** The current version's antivirus verdict; null for folders (no version).
   *  `pending`/`clean` both download today (docs/09 §2) — exposed so a future UI
   *  can show a "still scanning" indicator without an extra per-file round trip. */
  avStatus: AvStatus | null;
  sizeCached: number;
  mime: string | null;
  tags: string[];
  starredBy: string[];
  path: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BreadcrumbDto {
  id: string;
  name: string;
}

/** `parentId` omitted (or null) lists the space's root; `orgUnitId` is required
 *  for `space: 'org'` in that case, to resolve/provision the org's root folder. */
export const treeQuerySchema = z.object({
  space: z.enum(FS_SPACES),
  orgUnitId: uuid().optional(),
  parentId: uuid().optional(),
});
export type TreeQuery = z.infer<typeof treeQuerySchema>;

export interface TreeResponse {
  items: FsNodeDto[];
  breadcrumbs: BreadcrumbDto[];
  /** The folder whose children are listed; null only for an implicit personal root. */
  rootId: string | null;
}

export const createFolderSchema = z.object({
  space: z.enum(FS_SPACES),
  parentId: uuid().nullish(),
  orgUnitId: uuid().optional(),
  name: z.string().trim().min(1).max(255),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const initiateUploadSchema = z.object({
  space: z.enum(FS_SPACES),
  parentId: uuid().nullish(),
  orgUnitId: uuid().optional(),
  /** New version of this existing file node, instead of creating a new one. */
  targetNodeId: uuid().optional(),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().min(1).max(255),
});
export type InitiateUploadInput = z.infer<typeof initiateUploadSchema>;

export interface UploadPartUrl {
  partNumber: number;
  url: string;
}

export interface InitiateUploadResponse {
  uploadId: string;
  parts: UploadPartUrl[];
}

export const completeUploadSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), eTag: z.string().min(1) }))
    .min(1),
  // Computed client-side while streaming the upload — the server never sees the
  // raw bytes (they go straight to MinIO via presigned URLs), so it can't hash them
  // without downloading the whole object back.
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/, 'must be a lowercase hex SHA-256 digest'),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

/** Rename, move (`parentId`), and/or replace `tags` — all fields optional. */
export const patchNodeSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    parentId: uuid().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined || v.tags !== undefined, {
    message: 'At least one of name, parentId, tags is required',
  });
export type PatchNodeInput = z.infer<typeof patchNodeSchema>;

export const quotaQuerySchema = z.object({
  space: z.enum(['personal', 'org']),
  orgUnitId: uuid().optional(),
});
export type QuotaQuery = z.infer<typeof quotaQuerySchema>;

export interface QuotaDto {
  usedBytes: number;
  /** null = unlimited. */
  quotaBytes: number | null;
  remainingBytes: number | null;
}

export const trashQuerySchema = z.object({
  space: z.enum(FS_SPACES),
  orgUnitId: uuid().optional(),
});
export type TrashQuery = z.infer<typeof trashQuerySchema>;

export interface FileVersionDto {
  id: string;
  version: number;
  size: number;
  mime: string;
  checksumSha256: string;
  uploadedBy: string;
  avStatus: AvStatus;
  createdAt: string;
}

export const nodeKindSchema = z.enum(FS_NODE_KINDS);

// --- Sharing: ACL on a node + internal links (docs/modules/12 §1, §3, task 1.4) ---

/** Grant/upsert one subject's access level on a node (PUT /files/:id/acl). */
export const grantNodeAclSchema = z.object({
  subjectType: z.enum(ACL_SUBJECT_TYPES),
  subjectId: uuid(),
  level: z.enum(ACL_LEVELS),
});
export type GrantNodeAclInput = z.infer<typeof grantNodeAclSchema>;

/** Revoke one subject's grant (DELETE /files/:id/acl). */
export const revokeNodeAclSchema = z.object({
  subjectType: z.enum(ACL_SUBJECT_TYPES),
  subjectId: uuid(),
});
export type RevokeNodeAclInput = z.infer<typeof revokeNodeAclSchema>;

export interface NodeAclEntryDto {
  id: string;
  subjectType: AclSubjectType;
  subjectId: string;
  /** Resolved display name of the subject (user full name / org unit / role). */
  subjectName: string;
  level: AclLevel;
  /** When true, this grant comes from an ancestor folder, not the node itself. */
  inherited: boolean;
  /** The ancestor node id the grant is inherited from (null for a direct grant). */
  inheritedFrom: string | null;
}

export interface NodeAclResponse {
  /** Direct grants on this node (editable). */
  entries: NodeAclEntryDto[];
  /** Grants inherited from ancestor folders (read-only, shown with a badge). */
  inherited: NodeAclEntryDto[];
}

/** Create an internal link. `expiresInDays` null/omitted = never expires. */
export const createFileLinkSchema = z.object({
  expiresInDays: z.number().int().positive().max(3650).nullish(),
});
export type CreateFileLinkInput = z.infer<typeof createFileLinkSchema>;

export interface FileLinkDto {
  id: string;
  nodeId: string;
  token: string;
  /** Relative app path a client can copy — the SPA route that resolves the token. */
  url: string;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}
