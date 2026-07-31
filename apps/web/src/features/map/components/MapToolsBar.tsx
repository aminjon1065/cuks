import { useTranslation } from 'react-i18next';
import { Camera, Link2, Pentagon, Ruler, Trash2 } from 'lucide-react';
import { Button, cn } from '@cuks/ui';
import type { MeasureMode } from '../lib/measure';

export interface MapToolsBarProps {
  measureMode: MeasureMode;
  onMeasureModeChange: (mode: MeasureMode) => void;
  canClear: boolean;
  onClear: () => void;
  onExportPng: () => void;
  exporting?: boolean;
  onShareView: () => void;
  sharing?: boolean;
}

/**
 * Map tools (docs/modules/10 §4 / docs/06 §1): measure distance/area + PNG of the
 * current view + share permalink. Available in duty and GIS modes.
 */
export function MapToolsBar({
  measureMode,
  onMeasureModeChange,
  canClear,
  onClear,
  onExportPng,
  exporting = false,
  onShareView,
  sharing = false,
}: MapToolsBarProps): React.JSX.Element {
  const { t } = useTranslation('map');

  const toggle = (mode: Exclude<MeasureMode, 'none'>): void => {
    onMeasureModeChange(measureMode === mode ? 'none' : mode);
  };

  return (
    <div
      className="absolute right-3 top-14 z-20 flex flex-col gap-1 rounded border border-border bg-surface p-1 shadow-[var(--shadow-2)]"
      role="toolbar"
      aria-label={t('tools.toolbar')}
      aria-orientation="vertical"
      data-testid="map-tools"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-8', measureMode === 'distance' && 'bg-primary/10 text-primary')}
        aria-pressed={measureMode === 'distance'}
        aria-label={t('tools.distance')}
        title={t('tools.distance')}
        data-testid="map-tool-distance"
        onClick={() => toggle('distance')}
      >
        <Ruler className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-8', measureMode === 'area' && 'bg-primary/10 text-primary')}
        aria-pressed={measureMode === 'area'}
        aria-label={t('tools.area')}
        title={t('tools.area')}
        data-testid="map-tool-area"
        onClick={() => toggle('area')}
      >
        <Pentagon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t('tools.png')}
        title={t('tools.png')}
        data-testid="map-tool-png"
        disabled={exporting}
        onClick={onExportPng}
      >
        <Camera className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t('tools.share')}
        title={t('tools.share')}
        data-testid="map-tool-share"
        disabled={sharing}
        onClick={onShareView}
      >
        <Link2 className="size-4" />
      </Button>
      {canClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-text-muted"
          aria-label={t('tools.clear')}
          title={t('tools.clear')}
          data-testid="map-tool-clear"
          onClick={onClear}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
