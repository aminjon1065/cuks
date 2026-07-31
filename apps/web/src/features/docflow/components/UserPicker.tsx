import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Input, Label } from '@cuks/ui';
import { useDirectoryUsers } from '../api/queries';

export interface PickedUser {
  id: string;
  name: string;
}

/**
 * Pick people out of the directory by name (docs/modules/11 §12.11). Search-as-you-type
 * rather than a full list: the directory is thousands of rows, and a select that long is
 * unusable with a keyboard.
 */
export function UserPicker(props: {
  label: string;
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  required?: boolean;
  /** Ids already spoken for elsewhere in the form — not offered twice. */
  exclude?: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const id = useId();
  const [search, setSearch] = useState('');
  const directory = useDirectoryUsers(search);
  const options = (directory.data ?? []).filter((u) => !props.exclude?.includes(u.id));

  if (props.value) {
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{props.label}</Label>
        <div
          id={id}
          className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5 text-[13px] text-text"
        >
          <span>{props.value.name}</span>
          <button
            type="button"
            aria-label={t('common.clear')}
            className="text-text-muted hover:text-danger"
            onClick={() => props.onChange(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('resolutions.form.searchPlaceholder')}
        required={props.required}
      />
      {search.trim() ? (
        <div className="mt-1 max-h-36 overflow-y-auto rounded-sm border border-border">
          {options.length === 0 ? (
            <div className="py-2 text-center text-xs text-text-muted">
              {t('proposals.form.noMatches')}
            </div>
          ) : (
            options.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  props.onChange({ id: u.id, name: u.shortName });
                  setSearch('');
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[13px] text-text hover:bg-surface-2"
              >
                {u.shortName}
                <span className="ml-1.5 font-mono text-xs text-text-muted">@{u.username}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The same picker for a list — co-executors, or the people who must read first. */
export function UserMultiPicker(props: {
  label: string;
  hint?: string;
  value: readonly PickedUser[];
  onChange: (users: PickedUser[]) => void;
  exclude?: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const chosen = props.value.map((u) => u.id);
  return (
    <div className="flex flex-col gap-1">
      {props.value.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {props.value.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-0.5 text-xs text-text"
            >
              {u.name}
              <button
                type="button"
                aria-label={t('proposals.form.remove', { name: u.name })}
                className="text-text-muted hover:text-danger"
                onClick={() => props.onChange(props.value.filter((x) => x.id !== u.id))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <UserPicker
        label={props.label}
        value={null}
        exclude={[...chosen, ...(props.exclude ?? [])]}
        onChange={(u) => u && props.onChange([...props.value, u])}
      />
      {props.hint ? <p className="text-xs text-text-muted">{props.hint}</p> : null}
    </div>
  );
}
