import { cn } from '../lib/cn';

export type SeverityLevel = 1 | 2 | 3 | 4 | 5;

/** Emergency severity badge on the fixed sev-1..5 scale (docs/06 §2). Label via props (i18n). */
const toneByLevel: Record<SeverityLevel, string> = {
  1: 'bg-sev-1/15 text-sev-1',
  2: 'bg-sev-2/15 text-sev-2',
  3: 'bg-sev-3/15 text-sev-3',
  4: 'bg-sev-4/15 text-sev-4',
  5: 'bg-sev-5/15 text-sev-5',
};

const dotByLevel: Record<SeverityLevel, string> = {
  1: 'bg-sev-1',
  2: 'bg-sev-2',
  3: 'bg-sev-3',
  4: 'bg-sev-4',
  5: 'bg-sev-5',
};

export interface SeverityBadgeProps {
  level: SeverityLevel;
  label: React.ReactNode;
  className?: string;
}

export function SeverityBadge({ level, label, className }: SeverityBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium leading-none',
        toneByLevel[level],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotByLevel[level])} />
      {label}
    </span>
  );
}
