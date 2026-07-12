import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { cn } from '../lib/cn';

/** Avatar + name + position (docs/06 §4). */
export interface UserChipProps {
  name: string;
  position?: string;
  avatarUrl?: string;
  className?: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? '')
    .join('');
}

export function UserChip({
  name,
  position,
  avatarUrl,
  className,
}: UserChipProps): React.JSX.Element {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Avatar className="size-6">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-text">{name}</span>
        {position ? (
          <span className="block truncate text-xs text-text-muted">{position}</span>
        ) : null}
      </span>
    </span>
  );
}
