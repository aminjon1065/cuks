import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import { EmptyState, StatusBadge } from '@cuks/ui';
import type { JobRunHealth, JobRunStatus } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { durationParts } from '../lib';
import { Section } from './Section';

/**
 * Scheduled sweeps on the health screen (план СЭД, этап 4 «метрики длительности/ошибок»).
 *
 * Queue depth, already on this screen, does not answer the operator's question about a repeatable
 * job: a sweep that threw is retried and clears, and one that never started leaves nothing behind
 * at all. So each job is shown by its LAST run — when it finished, how long it took, what it did —
 * and by the verdict the API attached to it. The absence of a run is printed as absence: «ещё не
 * запускалась», never as a row of zeroes, because a zero here reads as «прошла и ничего не нашла».
 *
 * `health` is taken from the row rather than recomputed here: the thresholds are per job
 * (`JOB_STALE_AFTER_HOURS` — 26 hours for the daily sweeps, 33 days for the monthly one) and the
 * server's clock is the one that measured the age — a browser with a drifting clock must not turn
 * the whole panel amber.
 */

type TFn = ReturnType<typeof useTranslation>['t'];

/** Four distinguishable semantic tones — tokens only, so the dark theme flips with everything. */
const STATE_TONE: Record<JobRunHealth, 'success' | 'danger' | 'warning' | 'neutral'> = {
  ok: 'success',
  failed: 'danger',
  stale: 'warning',
  unknown: 'neutral',
};

function formatDuration(ms: number, t: TFn): string {
  const { unit, value } = durationParts(ms);
  return t(`health.jobs.duration.${unit}`, { value: value.toLocaleString('ru-RU') });
}

/**
 * Russian label for a counter the sweep reported (CLAUDE.md §2: the interface is Russian).
 *
 * The counters are free-form by contract — `JobRunRecord.counts` is deliberately open, so the
 * fourth sweep is not forced into the vocabulary of the first three — which means this map can
 * never be complete. A counter with no label yet degrades to its own English identifier, the
 * word the processor logs: worse than a translation, far better than an empty chip or the raw
 * key path `health.jobs.counter.newThing` that i18next would print unasked.
 */
function counterLabel(key: string, t: TFn): string {
  return t(`health.jobs.counter.${key}`, { defaultValue: key });
}

export function JobRunsSection({ jobs }: { jobs: JobRunStatus[] }): React.JSX.Element {
  const { t } = useTranslation('admin');
  return (
    <Section title={t('health.jobs.title')}>
      {jobs.length === 0 ? (
        <EmptyState
          icon={Timer}
          title={t('health.jobs.empty')}
          description={t('health.jobs.emptyHint')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <JobRunCard key={job.job} job={job} t={t} />
          ))}
        </div>
      )}
    </Section>
  );
}

function JobRunCard({ job, t }: { job: JobRunStatus; t: TFn }): React.JSX.Element {
  const counts = job.ran ? Object.entries(job.counts) : [];
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{t(`health.jobs.name.${job.job}`)}</span>
        <StatusBadge tone={STATE_TONE[job.health]} label={t(`health.jobs.state.${job.health}`)} />
      </div>

      {job.ran ? (
        <>
          <p className="text-xs text-text-muted">
            {t('health.jobs.lastRun', {
              at: formatDateTime(job.finishedAt),
              duration: formatDuration(job.durationMs, t),
            })}
          </p>
          {counts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {counts.map(([key, value]) => (
                <span
                  key={key}
                  className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
                >
                  {counterLabel(key, t)}{' '}
                  <span className="tabular-nums text-text">{value.toLocaleString('ru-RU')}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">{t('health.jobs.noCounts')}</p>
          )}
          {job.error ? (
            // The message, not just the badge: «сбой» without the reason sends the operator to the
            // container logs, which is exactly the trip this panel exists to save.
            <p className="break-words text-xs text-danger" title={job.error}>
              {job.error}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-text-muted">{t('health.jobs.never')}</p>
      )}
    </div>
  );
}
