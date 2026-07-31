import { useTranslation } from 'react-i18next';
import { Button, cn } from '@cuks/ui';
import type { MapExplorerMode } from '../lib/map-mode';

export interface MapModeSwitcherProps {
  value: MapExplorerMode;
  onChange: (mode: MapExplorerMode) => void;
}

/** Duty vs GIS mode toggle — ops-first chrome vs full explorer tools. */
export function MapModeSwitcher({ value, onChange }: MapModeSwitcherProps): React.JSX.Element {
  const { t } = useTranslation('map');
  return (
    <div
      className="absolute right-14 top-3 z-10 flex rounded border border-border bg-surface p-0.5 shadow-[var(--shadow-1)]"
      role="group"
      aria-label={t('mode.label')}
      data-testid="map-mode-switcher"
    >
      {(['duty', 'gis'] as const).map((mode) => (
        <Button
          key={mode}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'h-8 px-2.5 text-xs font-medium',
            value === mode
              ? 'bg-primary/10 text-primary hover:bg-primary/15'
              : 'text-text-muted hover:text-text',
          )}
          data-testid={`map-mode-${mode}`}
        >
          {t(`mode.${mode}`)}
        </Button>
      ))}
    </div>
  );
}
