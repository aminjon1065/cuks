import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Archive,
  BellRing,
  CheckCheck,
  Clock,
  FileSignature,
  Inbox,
  ListChecks,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { ATTENTION_QUEUES, type AttentionQueue } from '@cuks/shared';
import { Skeleton, cn } from '@cuks/ui';
import { useAttentionCounts } from '@/features/docflow/api/queries';

/**
 * «Требует внимания» (plan §8.8) — the eight document queues, in the order they matter: what
 * somebody is waiting on ME for, then what I owe, then what is late, then what the office owes.
 *
 * Every number is a link to the list that produced it, so the count and the screen behind it
 * answer the same question — a widget whose badge disagrees with its own link teaches people
 * to stop trusting the badge.
 *
 * A queue the caller may not see is ABSENT from the response, not zero: «Кандидаты к выбытию:
 * 0» would still tell somebody without the right that the queue exists. This component
 * renders what it was given and invents nothing.
 */
const QUEUE_ICONS: Record<AttentionQueue, LucideIcon> = {
  to_approve: CheckCheck,
  to_sign: FileSignature,
  to_acknowledge: BellRing,
  my_tasks: ListChecks,
  overdue: Clock,
  awaiting_dispatch: Send,
  new_incoming: Inbox,
  disposition_candidates: Archive,
};

/** Where a count drills down to. The list applies the same visibility rule as the count. */
const QUEUE_LINKS: Record<AttentionQueue, string> = {
  to_approve: '/app/docs?queue=to_approve',
  to_sign: '/app/docs?queue=to_sign',
  to_acknowledge: '/app/docs?queue=to_acknowledge',
  my_tasks: '/app/docs?queue=my_tasks',
  // These two carry the SAME predicates the counts use (`overdue`, `awaitingDispatch` on the
  // list DTO), so the screen behind a badge reproduces its number instead of showing a
  // superset the reader has to re-filter by eye.
  overdue: '/app/docs?queue=registry&overdue=true',
  awaiting_dispatch: '/app/docs?queue=registry&docClass=outgoing&awaitingDispatch=true',
  new_incoming: '/app/docs?queue=registry&docClass=incoming&status=registered',
  disposition_candidates: '/app/docs/archive?tab=candidates',
};

/** Late work is the one thing here that should look wrong when it is not zero. */
const ALARMING: readonly AttentionQueue[] = ['overdue'];

export function AttentionWidget(): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  const { data, isPending, isError } = useAttentionCounts();

  if (isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <p className="text-[13px] text-danger">{t('attention.failed')}</p>;
  }

  // Server order is not guaranteed by JSON, so the canonical order lives here.
  const rows = ATTENTION_QUEUES.filter((q) => data.counts[q] !== undefined);
  const pending = rows.filter((q) => (data.counts[q] ?? 0) > 0);

  if (pending.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
        <CheckCheck className="mx-auto mb-2 size-6 text-success" aria-hidden />
        <p className="text-[13px] text-text-muted">{t('attention.clear')}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {pending.map((queue) => {
        const Icon = QUEUE_ICONS[queue];
        const count = data.counts[queue] ?? 0;
        const alarming = ALARMING.includes(queue);
        return (
          <li key={queue}>
            <Link
              to={QUEUE_LINKS[queue]}
              className={cn(
                'flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13px]',
                'hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              )}
            >
              <Icon
                className={cn('size-4 shrink-0', alarming ? 'text-danger' : 'text-text-muted')}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-text">
                {t(`attention.queue.${queue}`)}
              </span>
              <span
                className={cn(
                  'rounded-sm px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  alarming ? 'bg-danger/10 text-danger' : 'bg-surface-muted text-text',
                )}
              >
                {/* Capped: past a hundred the exact number stops being information and starts
                    being a wide column. */}
                {count > 99 ? '99+' : count}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
