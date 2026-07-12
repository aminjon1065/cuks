import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

/** Empty state = icon + one line + first-action (docs/06 §1.5). */
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-[13px] text-text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
