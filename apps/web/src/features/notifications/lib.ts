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
  return {
    title: t(`types.${n.type}.title`, { defaultValue: n.title }),
    body: t(`types.${n.type}.body`, { defaultValue: n.body }),
  };
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
