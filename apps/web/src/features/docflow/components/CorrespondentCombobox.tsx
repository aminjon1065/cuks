import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Input, toast } from '@cuks/ui';
import { useCorrespondents, useCreateCorrespondent } from '../api/queries';

/**
 * Inline correspondent search + create (docs/modules/11 §4/§7): the registration wizard
 * finds a correspondent by name, or creates one on the fly if there is no match.
 */
export function CorrespondentCombobox({
  value,
  valueName,
  onChange,
}: {
  value: string | null;
  valueName: string | null;
  onChange: (id: string | null, name: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const results = useCorrespondents(search.trim());
  const create = useCreateCorrespondent();
  const items = results.data ?? [];
  const exactMatch = items.some((c) => c.name.toLowerCase() === search.trim().toLowerCase());

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5 text-[13px]">
        <span>{valueName}</span>
        <button
          type="button"
          className="text-text-muted hover:text-danger"
          onClick={() => onChange(null, null)}
        >
          {t('common.edit')}
        </button>
      </div>
    );
  }

  const createNew = () => {
    const name = search.trim();
    if (!name) return;
    create.mutate(
      { name },
      {
        onSuccess: (c) => onChange(c.id, c.name),
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('correspondents.searchPlaceholder')}
      />
      {search.trim() ? (
        <div className="max-h-40 overflow-y-auto rounded-sm border border-border">
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id, c.name)}
              className="flex w-full px-3 py-2 text-left text-[13px] hover:bg-surface-2"
            >
              {c.name}
            </button>
          ))}
          {!exactMatch ? (
            <button
              type="button"
              onClick={createNew}
              disabled={create.isPending}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] text-primary hover:bg-surface-2"
            >
              <Plus className="size-3.5" />{' '}
              {t('register.wizard.createCorrespondent', { name: search.trim() })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
