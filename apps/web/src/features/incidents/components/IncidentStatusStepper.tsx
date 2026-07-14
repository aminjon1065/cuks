import { Check } from 'lucide-react';
import { INCIDENT_STATUSES, type IncidentStatus } from '@cuks/shared';
import { cn } from '@cuks/ui';

export function IncidentStatusStepper({
  status,
  label,
  statusLabel,
}: {
  status: IncidentStatus;
  label: string;
  statusLabel: (status: IncidentStatus) => string;
}): React.JSX.Element {
  const currentIndex = INCIDENT_STATUSES.indexOf(status);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface px-4 py-3">
      <ol className="grid min-w-[680px] grid-cols-5" aria-label={label}>
        {INCIDENT_STATUSES.map((item, index) => {
          const complete = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={item}
              className="relative flex flex-col items-center gap-1.5 text-center"
              aria-current={current ? 'step' : undefined}
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute right-1/2 top-3 h-px w-full bg-border',
                    (complete || current) && 'bg-primary',
                  )}
                />
              ) : null}
              <span
                className={cn(
                  'relative z-10 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-text-muted',
                  complete && 'border-primary bg-primary text-primary-fg',
                  current && 'border-primary text-primary ring-2 ring-primary/20',
                )}
              >
                {complete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span className={cn('text-xs text-text-muted', current && 'font-medium text-text')}>
                {statusLabel(item)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
