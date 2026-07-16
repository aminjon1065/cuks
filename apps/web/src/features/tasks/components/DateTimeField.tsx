import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@cuks/ui';

/** Asia/Dushanbe is UTC+5 with no DST — deadlines are entered and shown in local wall time. */
const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;

/** A UTC ISO instant → the `datetime-local` value (`YYYY-MM-DDTHH:mm`) in Dushanbe wall time. */
function isoToLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + DUSHANBE_OFFSET_MS).toISOString().slice(0, 16);
}

/** A `datetime-local` value (read as Dushanbe wall time) → a UTC ISO instant. */
function localInputToIso(local: string): string {
  return new Date(new Date(`${local}:00Z`).getTime() - DUSHANBE_OFFSET_MS).toISOString();
}

/** A native datetime field storing a UTC ISO string, entered/shown in Asia/Dushanbe (docs/04). */
export function DateTimeField({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  return (
    <div className="flex items-center gap-1">
      <input
        type="datetime-local"
        disabled={disabled}
        value={value ? isoToLocalInput(value) : ''}
        onChange={(e) => onChange(e.target.value ? localInputToIso(e.target.value) : null)}
        className={cn(
          'h-8 flex-1 rounded-sm border border-border bg-surface px-2 text-[13px] text-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'disabled:opacity-60',
        )}
      />
      {value && !disabled ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          title={t('card.clearDate')}
          className="grid size-7 place-items-center rounded-sm text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
