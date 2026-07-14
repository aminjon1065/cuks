import { useTranslation } from 'react-i18next';
import { MousePointer2, MapPin, Spline, Pentagon } from 'lucide-react';
import { Button, cn } from '@cuks/ui';
import { toolsFor, type DrawTool } from '../lib/draw';

const ICONS: Record<Exclude<DrawTool, 'none'>, typeof MapPin> = {
  select: MousePointer2,
  point: MapPin,
  line: Spline,
  polygon: Pentagon,
};

export interface DrawToolbarProps {
  /** Layer being drawn into; the toolbar is hidden without one. */
  layerTitle: string;
  /** Geometry type the layer accepts (`null`/`Geometry` = any). */
  geometryType: string | null;
  value: DrawTool;
  onChange: (tool: DrawTool) => void;
  /** True while a geometry edit is unsaved — switching tools would discard it. */
  locked: boolean;
}

/**
 * Drawing tools (docs/modules/10 §4, «Инструменты»). Only the tools the target
 * layer's geometry type accepts are offered; the server enforces the same rule.
 * Clicking the active tool turns it off and hands the map back to navigation.
 *
 * While a geometry edit is open every tool is locked: switching would tear down the
 * editor and leave the feature hidden (it is drawn by terra-draw, not by the tiles)
 * with an unsaved geometry. The edit is finished from the inspector — save or cancel.
 */
export function DrawToolbar({
  layerTitle,
  geometryType,
  value,
  onChange,
  locked,
}: DrawToolbarProps): React.JSX.Element {
  const { t } = useTranslation('map');
  const tools: DrawTool[] = ['select', ...toolsFor(geometryType)];

  return (
    <div
      className="absolute right-3 top-16 z-20 flex flex-col gap-1 rounded border border-border bg-surface p-1 shadow-[var(--shadow-2)]"
      role="toolbar"
      aria-label={t('draw.toolbar', { name: layerTitle })}
      aria-orientation="vertical"
      data-testid="draw-toolbar"
    >
      {tools.map((tool) => {
        const Icon = ICONS[tool as Exclude<DrawTool, 'none'>];
        const active = value === tool;
        const label = t(`draw.tools.${tool}`);
        return (
          <Button
            key={tool}
            variant="ghost"
            size="icon"
            className={cn('size-8', active && 'bg-primary/10 text-primary')}
            aria-pressed={active}
            aria-label={label}
            title={label}
            disabled={locked}
            data-testid={`draw-tool-${tool}`}
            onClick={() => onChange(active ? 'none' : tool)}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </div>
  );
}
