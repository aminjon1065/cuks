import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileText, Search } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@cuks/ui';
import { useVisibleByPermission } from '@/lib/ability';
import { useQuickSearch } from '@/features/docflow/api/queries';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ADMIN_NAV, MAIN_NAV } from './nav-items';

/**
 * Cmd+K (docs/06 §3, plan §8.8): navigation plus a document source.
 *
 * The document rows come from `/docflow/search/quick`, which applies the SAME server-side
 * visibility policy as the register and the full search. That is the whole point of routing
 * the palette through the server instead of filtering something already loaded: a palette
 * with its own idea of who may see what is a second policy, and the second one is the one
 * that leaks (AC-SED-06 — «B не видит его в … Cmd+K»).
 *
 * `shouldFilter={false}` on the dialog because cmdk's own fuzzy filter would otherwise
 * re-filter the server's answer against the raw query and drop rows that matched by
 * morphology or by attachment text — a hit the client cannot see the reason for.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();
  const adminItems = useVisibleByPermission(ADMIN_NAV);
  const items = [...MAIN_NAV, ...adminItems];
  const [query, setQuery] = useState('');
  // Debounced: the palette fires on every keystroke, and the search endpoint has a budget.
  const debounced = useDebouncedValue(query, 250);
  const { data: documents, isFetching } = useQuickSearch(debounced);

  const go = (path: string): void => {
    onOpenChange(false);
    setQuery('');
    navigate(path);
  };

  const navMatches = items.filter((item) =>
    t(`items.${item.key}`).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const hits = documents ?? [];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      label={t('commandPalette.open')}
      shouldFilter={false}
    >
      <CommandInput
        placeholder={t('commandPalette.placeholder')}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {navMatches.length === 0 && hits.length === 0 && !isFetching ? (
          <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>
        ) : null}

        {navMatches.length > 0 ? (
          <CommandGroup heading={t('commandPalette.groupNavigation')}>
            {navMatches.map((item) => {
              const Icon = item.icon;
              const label = t(`items.${item.key}`);
              return (
                <CommandItem key={item.key} value={label} onSelect={() => go(item.path)}>
                  <Icon />
                  {label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {hits.length > 0 ? (
          <CommandGroup heading={t('commandPalette.groupDocuments')}>
            {hits.map((doc) => (
              <CommandItem key={doc.id} value={doc.id} onSelect={() => go(`/app/docs/${doc.id}`)}>
                <FileText />
                <span className="min-w-0 flex-1 truncate">{doc.subject}</span>
                {doc.regNumber ? (
                  <span className="shrink-0 font-mono text-xs text-text-muted">
                    {doc.regNumber}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {/* Offered whatever the palette found: five rows is a shortcut, and the full search is
            where the rest of an answer lives. */}
        {query.trim().length > 1 ? (
          <CommandGroup heading={t('commandPalette.groupSearch')}>
            <CommandItem
              value="__search__"
              onSelect={() => go(`/app/docs/search?q=${encodeURIComponent(query.trim())}`)}
            >
              <Search />
              {t('commandPalette.searchAll', { query: query.trim() })}
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
