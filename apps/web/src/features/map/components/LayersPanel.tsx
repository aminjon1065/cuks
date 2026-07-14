import { useTranslation } from 'react-i18next';
import { Crosshair, Layers, PanelLeftClose } from 'lucide-react';
import { Button, Checkbox, cn, Slider } from '@cuks/ui';
import {
  PANEL_GROUP_ORDER,
  SYSTEM_LAYERS,
  type LayerState,
  type LegendItem,
  type SystemLayerDef,
} from '../lib/layers';

export interface LayersPanelProps {
  states: Record<string, LayerState>;
  availableSources: ReadonlySet<string> | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onToggle: (layerId: string, visible: boolean) => void;
  onOpacity: (layerId: string, opacity: number) => void;
  onZoom: (source: string) => void;
}

/** A single legend row: a themed swatch + its label. */
function LegendSwatch({ item }: { item: LegendItem }): React.JSX.Element {
  const { t } = useTranslation('map');
  const color = `var(${item.token})`;
  return (
    <li className="flex items-center gap-2 text-xs text-text-muted">
      {item.shape === 'line' ? (
        <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: color }} />
      ) : item.shape === 'cross' ? (
        <span
          className="inline-flex size-3 items-center justify-center text-base leading-none"
          style={{ color }}
        >
          ×
        </span>
      ) : (
        <span
          className={cn(
            'inline-block size-3 border-current',
            item.shape === 'circle' ? 'rounded-full' : 'rounded-sm',
            item.shape === 'active' && 'rounded-full border-[3px] bg-transparent',
            item.shape === 'diamond' && 'rotate-45 rounded-[1px]',
          )}
          style={{
            background: item.shape === 'active' ? 'transparent' : color,
            borderColor: color,
            opacity: item.shape === 'fill' ? 0.55 : 1,
          }}
        />
      )}
      <span>{t(item.labelKey)}</span>
    </li>
  );
}

function LayerRow({
  def,
  state,
  onToggle,
  onOpacity,
  onZoom,
}: {
  def: SystemLayerDef;
  state: LayerState;
  onToggle: LayersPanelProps['onToggle'];
  onOpacity: LayersPanelProps['onOpacity'];
  onZoom: LayersPanelProps['onZoom'];
}): React.JSX.Element {
  const { t } = useTranslation('map');
  const title = t(def.titleKey);
  return (
    <li className="rounded-sm px-2 py-1.5 hover:bg-surface-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`layer-${def.id}`}
          checked={state.visible}
          onCheckedChange={(checked) => onToggle(def.id, checked === true)}
          aria-label={title}
        />
        <label
          htmlFor={`layer-${def.id}`}
          className="flex-1 cursor-pointer truncate text-sm text-text"
        >
          {title}
        </label>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-text-muted"
          onClick={() => onZoom(def.source)}
          aria-label={t('panel.zoomToLayer', { name: title })}
          title={t('panel.zoomToLayer', { name: title })}
        >
          <Crosshair className="size-3.5" />
        </Button>
      </div>
      {state.visible && (
        <div className="mt-2 space-y-2 pl-6">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-text-muted">{t('panel.opacity')}</span>
            <Slider
              value={[state.opacity]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(value) => onOpacity(def.id, value[0] ?? 1)}
              aria-label={t('panel.opacityFor', { name: title })}
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-muted">
              {Math.round(state.opacity * 100)}%
            </span>
          </div>
          {def.legend.length > 0 && (
            <ul className="space-y-1">
              {def.legend.map((item) => (
                <LegendSwatch key={item.labelKey} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Map layer panel (docs/modules/10 §4, docs/06 §6): grouped layers with
 * visibility checkboxes, opacity, legends, and zoom-to-layer. Collapsible to give
 * the map full width.
 */
export function LayersPanel({
  states,
  availableSources,
  collapsed,
  onCollapsedChange,
  onToggle,
  onOpacity,
  onZoom,
}: LayersPanelProps): React.JSX.Element {
  const { t } = useTranslation('map');

  if (collapsed) {
    return (
      <div className="absolute left-3 top-3 z-20">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => onCollapsedChange(false)}
          aria-label={t('panel.expand')}
          title={t('panel.expand')}
        >
          <Layers className="size-4" />
        </Button>
      </div>
    );
  }

  const available = SYSTEM_LAYERS.filter(
    (def) => !availableSources || availableSources.has(def.source),
  );
  const groups = PANEL_GROUP_ORDER.map((group) => ({
    group,
    layers: available.filter((def) => def.group === group),
  })).filter((entry) => entry.layers.length > 0);

  return (
    <div className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] max-w-72 flex-col overflow-hidden rounded border border-border bg-surface shadow-[var(--shadow-2)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-text">
          <Layers className="size-4 text-text-muted" />
          {t('panel.layers')}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-text-muted"
          onClick={() => onCollapsedChange(true)}
          aria-label={t('panel.collapse')}
          title={t('panel.collapse')}
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-text-muted">{t('panel.noLayers')}</p>
        ) : (
          groups.map(({ group, layers }) => (
            <section key={group} className="mb-2 last:mb-0">
              <h3 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t(`groups.${group}`)}
              </h3>
              <ul>
                {layers.map((def) => (
                  <LayerRow
                    key={def.id}
                    def={def}
                    state={states[def.id] ?? { visible: def.defaultVisible, opacity: 1 }}
                    onToggle={onToggle}
                    onOpacity={onOpacity}
                    onZoom={onZoom}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
