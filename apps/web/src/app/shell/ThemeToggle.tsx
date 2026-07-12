import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@cuks/ui';
import { resolveTheme, useThemeStore, type ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
];

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('common');
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const CurrentIcon = resolveTheme(theme) === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={collapsed ? 'icon' : 'sm'} aria-label={t('theme.label')}>
          <CurrentIcon />
          {collapsed ? null : <span className="ml-1">{t('theme.label')}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
        {OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={theme === value}
            onCheckedChange={() => setTheme(value)}
          >
            <span className="flex items-center gap-2">
              <Icon className="size-4 text-text-muted" />
              {t(`theme.${value}`)}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
