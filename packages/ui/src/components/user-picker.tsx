import { useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '../lib/cn';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Searchable single-select picker for people/units (docs/06 §4). Presentational:
 * options are supplied by the consumer; all labels are passed in (i18n).
 */
export interface UserPickerProps {
  options: PickerOption[];
  value?: string | null;
  onChange: (id: string) => void;
  placeholder?: React.ReactNode;
  searchPlaceholder?: string;
  emptyLabel?: React.ReactNode;
  disabled?: boolean;
}

export function UserPicker({
  options,
  value,
  onChange,
  placeholder = '—',
  searchPlaceholder,
  emptyLabel = 'Nothing found',
  disabled = false,
}: UserPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false),
      )
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selected && 'text-text-muted')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="flex items-center gap-2 border-b border-border px-2">
          <Search className="size-4 shrink-0 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 border-0 px-0 focus-visible:ring-0"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-2 py-6 text-center text-[13px] text-text-muted">{emptyLabel}</li>
          ) : (
            filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-text">{o.label}</span>
                    {o.sublabel ? (
                      <span className="block truncate text-xs text-text-muted">{o.sublabel}</span>
                    ) : null}
                  </span>
                  {o.id === value ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
