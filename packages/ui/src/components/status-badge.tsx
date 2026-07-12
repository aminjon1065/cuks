import { Badge, type BadgeProps } from './badge';
import { cn } from '../lib/cn';

/**
 * Status badge with a leading colour dot (docs/06 §1: status always visible).
 * `tone` comes from the module's status→tone map; the label is passed in (i18n).
 */
export interface StatusBadgeProps extends Omit<BadgeProps, 'children'> {
  label: React.ReactNode;
}

const dotByTone: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-text-muted',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function StatusBadge({
  label,
  tone,
  className,
  ...props
}: StatusBadgeProps): React.JSX.Element {
  const t = tone ?? 'neutral';
  return (
    <Badge tone={t} className={cn('gap-1.5', className)} {...props}>
      <span className={cn('size-1.5 rounded-full', dotByTone[t])} />
      {label}
    </Badge>
  );
}
