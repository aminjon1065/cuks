/**
 * Notification taxonomy (docs/07 §notifications, docs/16 §B). A notification
 * `type` is a dotted code `<group>.<entity>.<event>` (e.g. `docflow.route.assigned`);
 * its first segment is the `type_group` that the preferences matrix toggles.
 * Feature modules add `type` codes over time; the groups are fixed here so a
 * user's saved preferences never churn.
 */
export const NOTIFICATION_CHANNELS = ['inapp', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_GROUPS = [
  'system',
  'docflow',
  'tasks',
  'chat',
  'meet',
  'incidents',
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/**
 * Groups whose in-app channel cannot be turned off (docs/07: document assignments
 * and calls; docs/16 adds incidents). Critical notifications are always delivered
 * in-app regardless of preferences.
 */
export const CRITICAL_GROUPS: readonly NotificationGroup[] = ['docflow', 'meet', 'incidents'];

export function isGroupCritical(group: NotificationGroup): boolean {
  return CRITICAL_GROUPS.includes(group);
}

/** Resolve a notification `type` code to its group (first segment; falls back to `system`). */
export function groupOfType(type: string): NotificationGroup {
  const head = type.split('.')[0];
  return (NOTIFICATION_GROUPS as readonly string[]).includes(head ?? '')
    ? (head as NotificationGroup)
    : 'system';
}
