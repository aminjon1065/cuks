import { X } from 'lucide-react';
import { Button } from './button';
import { cn } from '../lib/cn';

export interface FilterChip {
  key: string;
  label: React.ReactNode;
  onRemove?: () => void;
}

/** Filter row above tables: controls + active-filter chips + reset (docs/06 §4). */
export interface FilterBarProps {
  chips?: FilterChip[];
  onReset?: () => void;
  resetLabel?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function FilterBar({
  chips = [],
  onReset,
  resetLabel = 'Reset',
  children,
  className,
}: FilterBarProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-1 text-xs text-text"
        >
          {c.label}
          {c.onRemove ? (
            <button
              type="button"
              onClick={c.onRemove}
              className="text-text-muted transition-colors hover:text-text"
              aria-label="remove filter"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {chips.length > 0 && onReset ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          {resetLabel}
        </Button>
      ) : null}
    </div>
  );
}
