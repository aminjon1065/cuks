import { useTranslation } from 'react-i18next';
import { CalendarClock, CheckSquare, MessageSquare } from 'lucide-react';
import { StatusBadge, cn } from '@cuks/ui';
import type { BoardMemberDto, LabelDto, TaskCardDto } from '@cuks/shared';
import { formatDate } from '@/lib/format';
import { PRIORITY_STRIPE, dueTone, labelDot } from '../lib/task-ui';

/** A card as it appears on the board (docs/modules/15 §3) — presentational. */
export function TaskCardView({
  card,
  projectKey,
  members,
  labels,
}: {
  card: TaskCardDto;
  projectKey: string;
  members: BoardMemberDto[];
  labels: LabelDto[];
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const done = !!card.completedAt;
  const cardLabels = labels.filter((l) => card.labels.includes(l.id));
  const assignees = card.assigneeIds
    .map((id) => members.find((m) => m.userId === id)?.name)
    .filter((n): n is string => !!n);

  return (
    <div
      className={cn(
        'relative flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5 pl-3 shadow-sm',
        'hover:border-primary/40',
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-0 h-full w-1 rounded-l-md',
          PRIORITY_STRIPE[card.priority],
        )}
      />
      {cardLabels.length ? (
        <div className="flex flex-wrap gap-1">
          {cardLabels.map((l) => (
            <span key={l.id} className={cn('h-1.5 w-6 rounded-full', labelDot(l.color))} />
          ))}
        </div>
      ) : null}
      <p className={cn('text-[13px] text-text', done && 'text-text-muted line-through')}>
        {card.title}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <span className="font-mono">
          {projectKey}-{card.seq}
        </span>
        {card.dueAt ? (
          <StatusBadge
            tone={dueTone(card.dueAt, done)}
            label={
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3" /> {formatDate(card.dueAt)}
              </span>
            }
          />
        ) : null}
        {card.checklistTotal > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <CheckSquare className="size-3" /> {card.checklistDone}/{card.checklistTotal}
          </span>
        ) : null}
        {card.commentCount > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare className="size-3" /> {card.commentCount}
          </span>
        ) : null}
        {assignees.length ? (
          <span className="ml-auto flex -space-x-1.5">
            {assignees.slice(0, 3).map((name, i) => (
              <span
                key={i}
                title={name}
                className="grid size-5 place-items-center rounded-full border border-surface bg-primary/15 text-[10px] font-medium text-primary"
              >
                {initials(name)}
              </span>
            ))}
            {assignees.length > 3 ? (
              <span className="grid size-5 place-items-center rounded-full border border-surface bg-surface-2 text-[10px] text-text-muted">
                +{assignees.length - 3}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="ml-auto text-xs text-text-muted">{t('card.unassigned')}</span>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—';
}
