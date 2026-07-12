import { cn } from '../lib/cn';

/** Page title + status (left of title) + primary actions (right) — docs/06 §1, §8. */
export interface PageHeaderProps {
  title: React.ReactNode;
  status?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  status,
  description,
  actions,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <div className={cn('flex items-start justify-between gap-4 pb-4', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {status}
          <h1 className="truncate text-xl font-semibold text-text">{title}</h1>
        </div>
        {description ? <p className="mt-0.5 text-[13px] text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
