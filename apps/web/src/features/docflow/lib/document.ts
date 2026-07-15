import type { BadgeProps } from '@cuks/ui';
import type { DocumentStatus } from '@cuks/shared';

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
