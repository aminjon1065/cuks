import type { BadgeProps } from '@cuks/ui';
import type { ControlSeverity, DocumentStatus } from '@cuks/shared';

/** Document status → badge tone (docs/06 §1: status always visible via colour). */
export const documentStatusTone: Record<DocumentStatus, NonNullable<BadgeProps['tone']>> = {
  draft: 'neutral',
  on_route: 'info',
  pending_registration: 'warning',
  registered: 'primary',
  in_progress: 'info',
  completed: 'success',
  archived: 'neutral',
  rejected: 'danger',
  recalled: 'neutral',
};

/**
 * Same-origin URL for a document's file (plan этап 1C). The API applies the document
 * visibility, ДСП and antivirus gate, then 302s to a short-lived presigned URL — the
 * client never holds a storage link, and a file is never reachable by its node id alone.
 */
export function documentFileDownloadUrl(documentId: string, fileId: string): string {
  return `/api/v1/docflow/documents/${documentId}/files/${fileId}/download`;
}

/** Deadline severity → tone for the «На контроле» color scale (docs/modules/11 §5). */
export const controlSeverityTone: Record<ControlSeverity, NonNullable<BadgeProps['tone']>> = {
  normal: 'neutral',
  warning: 'warning',
  overdue: 'danger',
};
