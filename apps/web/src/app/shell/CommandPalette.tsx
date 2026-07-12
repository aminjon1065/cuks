import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@cuks/ui';
import { useVisibleByPermission } from '@/lib/ability';
import { ADMIN_NAV, MAIN_NAV } from './nav-items';

/**
 * Cmd+K command palette (docs/06 §3). Phase 0.8 skeleton: navigation only — global
 * search across entities and quick actions land with their owning modules.
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

  const go = (path: string): void => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={t('commandPalette.open')}>
      <CommandInput placeholder={t('commandPalette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>
        <CommandGroup heading={t('commandPalette.groupNavigation')}>
          {items.map((item) => {
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
      </CommandList>
    </CommandDialog>
  );
}
