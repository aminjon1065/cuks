import {
  Bell,
  CalendarClock,
  FileText,
  ListTodo,
  MessageSquare,
  Settings,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationDto, NotificationGroup } from '@cuks/shared';
import type { TFunction } from 'i18next';

const GROUP_ICON: Record<NotificationGroup, LucideIcon> = {
  system: Settings,
  docflow: FileText,
  tasks: ListTodo,
  chat: MessageSquare,
  meet: CalendarClock,
  incidents: ShieldAlert,
};

export function groupIcon(group: NotificationGroup): LucideIcon {
  return GROUP_ICON[group] ?? Bell;
}

/**
 * Display title/body for a notification. Known `type` codes render from the
 * `notifications:types.*` catalog (localized per viewer); anything else falls back
 * to the server-stored text.
 */
export function notificationText(
  t: TFunction,
  n: NotificationDto,
): { title: string; body: string } {
  const number = typeof n.payload['number'] === 'string' ? n.payload['number'] : null;
  const severity = typeof n.payload['severity'] === 'number' ? n.payload['severity'] : null;
  const fromStatus = typeof n.payload['fromStatus'] === 'string' ? n.payload['fromStatus'] : null;
  const toStatus = typeof n.payload['toStatus'] === 'string' ? n.payload['toStatus'] : null;
  const isIncident = n.type.startsWith('incidents.incident.');
  const hasIncidentPayload =
    !isIncident ||
    (!!number &&
      (n.type !== 'incidents.incident.created' || severity !== null) &&
      (n.type !== 'incidents.incident.status_changed' || (!!fromStatus && !!toStatus)));
  if (!hasIncidentPayload) return { title: n.title, body: n.body };

  const values = {
    ...n.payload,
    number,
    severity,
    fromStatus: fromStatus
      ? t(`incidents:status.${fromStatus}`, { defaultValue: fromStatus })
      : null,
    toStatus: toStatus ? t(`incidents:status.${toStatus}`, { defaultValue: toStatus }) : null,
  };
  return {
    title: t(`types.${n.type}.title`, { ...values, defaultValue: n.title }),
    body: t(`types.${n.type}.body`, { ...values, defaultValue: n.body }),
  };
}

/** Permanent app route for notification-backed entities. */
export function notificationHref(notification: NotificationDto): string | null {
  if (notification.entityType === 'incident' && notification.entityId) {
    return `/app/incidents/${notification.entityId}`;
  }
  // A finished import puts its layer on the map. A finished export is downloaded
  // from there too — its link is a short-lived presigned URL fetched on demand, so
  // the notification cannot bake it in; instead it deep-links the map with
  // `?export=<id>`, which reopens the export ready to download (docs/modules/10 §6).
  if (notification.entityType === 'gis_export' && notification.entityId) {
    return `/app/map?export=${notification.entityId}`;
  }
  if (notification.entityType === 'gis_import') {
    return '/app/map';
  }
  return null;
}

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/** Localized relative time ("5 минут назад") via Intl — no hardcoded strings. */
export function formatRelativeTime(iso: string, locale: string, now: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let duration = (new Date(iso).getTime() - now) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return rtf.format(Math.round(duration), 'year');
}
