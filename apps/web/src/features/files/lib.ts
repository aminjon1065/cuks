import { Folder, type LucideIcon } from 'lucide-react';
import { fileIcon } from '@cuks/ui';
import type { FsNodeDto } from '@cuks/shared';

// Re-exported for back-compat; the implementations live in the shared web util
// so the uploads feature can share them without depending on the files feature.
export { formatBytes, formatDateTime } from '@/lib/format';

/** Icon for a node — folders get a folder, files an icon keyed off their mime. */
export function nodeIcon(node: Pick<FsNodeDto, 'kind' | 'mime'>): LucideIcon {
  return node.kind === 'folder' ? Folder : fileIcon(node.mime);
}

/** True for a node whose current version can show an image preview tile. */
export function isImage(node: Pick<FsNodeDto, 'kind' | 'mime'>): boolean {
  return node.kind === 'file' && (node.mime ?? '').startsWith('image/');
}

/** Same-origin download URL — the API 302s to a presigned MinIO URL. Media
 *  elements and fetch both follow the redirect; MinIO serves cross-origin reads
 *  with range support, so viewers need no proxy. */
export function downloadUrl(id: string): string {
  return `/api/v1/files/${id}/download`;
}
