import { useTranslation } from 'react-i18next';
import { Skeleton } from '@cuks/ui';
import type { ActivityDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useActivity } from '../api/queries';

/** The «История» trail of a card (docs/modules/15 §4) — newest first. */
export function HistoryTab({ cardId }: { cardId: string }): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const activity = useActivity(cardId);

  /** Human sentence for an activity row, resolving `updated` field lists via i18n. */
  const describe = (a: ActivityDto): string => {
    switch (a.action) {
      case 'tasks.card.created':
        return t('card.activity.created');
      case 'tasks.card.moved':
        return t('card.activity.moved');
      case 'tasks.card.completed':
        return t('card.activity.completed');
      case 'tasks.card.commented':
        return t('card.activity.commented');
      case 'tasks.card.assigned':
        return t('card.activity.assigned');
      case 'tasks.card.updated': {
        const fields = Array.isArray(a.meta?.fields) ? (a.meta!.fields as string[]) : [];
        return t('card.activity.updated', {
          fields: fields.map((f) => t(`card.field.${f}`)).join(', '),
        });
      }
      default:
        return a.action;
    }
  };

  if (activity.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>
    );
  }
  if ((activity.data ?? []).length === 0) {
    return <p className="py-4 text-center text-sm text-text-muted">{t('card.noHistory')}</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {activity.data!.map((a) => (
        <li key={a.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
          <span className="text-[13px] text-text">
            <span className="font-medium">{a.actorName ?? t('card.system')}</span> {describe(a)}
          </span>
          <span className="text-xs text-text-muted">{formatDateTime(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
