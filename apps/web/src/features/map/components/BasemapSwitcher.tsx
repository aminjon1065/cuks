import { useTranslation } from 'react-i18next';
import { Check, Layers2, Moon, Sun, SunMoon } from 'lucide-react';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@cuks/ui';
import type { BasemapMode } from '../lib/basemap';

const OPTIONS: { mode: BasemapMode; labelKey: string; icon: typeof Sun }[] = [
  { mode: 'auto', labelKey: 'basemap.auto', icon: SunMoon },
  { mode: 'light', labelKey: 'basemap.schema', icon: Sun },
  { mode: 'dark', labelKey: 'basemap.dark', icon: Moon },
];

export interface BasemapSwitcherProps {
  value: BasemapMode;
  onChange: (mode: BasemapMode) => void;
}

/** Basemap switcher (docs/modules/10 §4): follow-theme / light / dark. Top-right. */
export function BasemapSwitcher({ value, onChange }: BasemapSwitcherProps): React.JSX.Element {
  const { t } = useTranslation('map');
  return (
    <div className="absolute right-3 top-3 z-10">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('basemap.label')}
            title={t('basemap.label')}
          >
            <Layers2 className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          {OPTIONS.map(({ mode, labelKey, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={value === mode}
              onClick={() => onChange(mode)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-2',
                value === mode ? 'text-text' : 'text-text-muted',
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1">{t(labelKey)}</span>
              {value === mode && <Check className="size-3.5 text-primary" aria-hidden />}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
