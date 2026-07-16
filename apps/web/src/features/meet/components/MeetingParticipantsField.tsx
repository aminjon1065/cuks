import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import type { MeetingParticipants } from '@cuks/shared';
import { Input, Popover, PopoverContent, PopoverTrigger, cn } from '@cuks/ui';
import { useDirectoryOrgUnits, useDirectoryUsers } from '@/features/files/api/queries';

function Chip({ label, onRemove }: { label: string; onRemove: () => void }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-xs text-primary">
      <span className="max-w-40 truncate">{label}</span>
      <button type="button" onClick={onRemove} className="hover:text-danger" aria-label="remove">
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Multi-select of invitees — individual users (directory search) and whole org units
 *  (docs/modules/14 §5, task 6.5). */
export function MeetingParticipantsField({
  value,
  onChange,
}: {
  value: MeetingParticipants;
  onChange: (next: MeetingParticipants) => void;
}): React.JSX.Element {
  const { t } = useTranslation('meet');
  const [userSearch, setUserSearch] = useState('');
  const usersQ = useDirectoryUsers(userSearch);
  const orgUnitsQ = useDirectoryOrgUnits();
  // Remember names of picked users so their chips stay labelled after the search box changes.
  const nameCache = useRef(new Map<string, string>());
  for (const u of usersQ.data ?? []) nameCache.current.set(u.id, u.shortName);
  const orgById = new Map((orgUnitsQ.data ?? []).map((o) => [o.id, o.name]));

  const toggleUser = (id: string): void =>
    onChange({
      ...value,
      users: value.users.includes(id) ? value.users.filter((v) => v !== id) : [...value.users, id],
    });
  const toggleOrg = (id: string): void =>
    onChange({
      ...value,
      orgUnits: value.orgUnits.includes(id)
        ? value.orgUnits.filter((v) => v !== id)
        : [...value.orgUnits, id],
    });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-text">{t('schedule.users')}</p>
        <div className="flex flex-wrap items-center gap-1">
          {value.users.map((id) => (
            <Chip
              key={id}
              label={nameCache.current.get(id) ?? id}
              onRemove={() => toggleUser(id)}
            />
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-muted hover:border-primary/50 hover:text-text"
              >
                <Plus className="size-3" /> {t('schedule.addUser')}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-1" align="start">
              <Input
                autoFocus
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={t('schedule.searchUser')}
                className="mb-1 h-8"
              />
              <div className="max-h-56 overflow-y-auto">
                {(usersQ.data ?? []).map((u) => {
                  const selected = value.users.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                        selected && 'text-primary',
                      )}
                    >
                      <span className="flex-1 truncate">{u.shortName}</span>
                      {selected ? <Check className="size-3.5" /> : null}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-text">{t('schedule.orgUnits')}</p>
        <div className="flex flex-wrap items-center gap-1">
          {value.orgUnits.map((id) => (
            <Chip key={id} label={orgById.get(id) ?? id} onRemove={() => toggleOrg(id)} />
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-muted hover:border-primary/50 hover:text-text"
              >
                <Plus className="size-3" /> {t('schedule.addOrgUnit')}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1" align="start">
              <div className="max-h-56 overflow-y-auto">
                {(orgUnitsQ.data ?? []).map((o) => {
                  const selected = value.orgUnits.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOrg(o.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                        selected && 'text-primary',
                      )}
                    >
                      <span className="flex-1 truncate">{o.name}</span>
                      {selected ? <Check className="size-3.5" /> : null}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
