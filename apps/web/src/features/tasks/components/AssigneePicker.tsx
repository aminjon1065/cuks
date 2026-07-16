import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import { Input, Popover, PopoverContent, PopoverTrigger, cn } from '@cuks/ui';
import type { BoardMemberDto } from '@cuks/shared';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—';
}

/** Multi-select assignees drawn from the project's members (docs/modules/15 §4). */
export function AssigneePicker({
  members,
  value,
  onChange,
  disabled,
}: {
  members: BoardMemberDto[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const byId = new Map(members.map((m) => [m.userId, m.name ?? m.userId]));
  const q = search.trim().toLowerCase();
  const options = members.filter((m) => !q || (m.name ?? '').toLowerCase().includes(q));

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-1 pr-1.5 text-xs text-primary"
        >
          <span className="grid size-4 place-items-center rounded-full bg-primary/20 text-[9px] font-medium">
            {initials(byId.get(id) ?? '—')}
          </span>
          <span className="max-w-32 truncate">{byId.get(id) ?? id}</span>
          {!disabled ? (
            <button type="button" onClick={() => toggle(id)} className="hover:text-danger">
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-muted hover:border-primary/50 hover:text-text"
            >
              <Plus className="size-3" /> {t('card.addAssignee')}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="start">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('card.searchMember')}
              className="mb-1 h-8"
            />
            <div className="max-h-56 overflow-y-auto">
              {options.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-text-muted">
                  {t('card.noMembers')}
                </p>
              ) : (
                options.map((m) => {
                  const selected = value.includes(m.userId);
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => toggle(m.userId)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                        selected && 'text-primary',
                      )}
                    >
                      <span className="grid size-5 place-items-center rounded-full bg-primary/15 text-[10px] font-medium text-primary">
                        {initials(m.name ?? '—')}
                      </span>
                      <span className="flex-1 truncate">{m.name ?? m.userId}</span>
                      {selected ? <Check className="size-3.5" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
