import { useTranslation } from 'react-i18next';
import {
  Crosshair,
  Download,
  FileUp,
  Layers,
  PanelLeftClose,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button, Checkbox, cn, Skeleton, Slider } from '@cuks/ui';
import {
  PANEL_GROUP_ORDER,
  registryLayer,
  SYSTEM_LAYERS,
  type LayerGroup,
  type LayerState,
  type LegendItem,
  type MapLayerDef,
} from '../lib/layers';

export interface LayersPanelProps {
  states: Record<string, LayerState>;
  availableSources: ReadonlySet<string> | null;
  /** The user's drawn layers, compiled from `GET /gis/layers`. */
  drawnDefs: readonly MapLayerDef[];
  /** Layer the drawing tools write into (`null` = none picked yet). */
  activeLayerId: string | null;
  /** `gis.layers.manage` (docs/05) — hides the create action for everyone else. */
  canCreateLayer: boolean;
  /** `gis.import` — hides the import action (task 2.8). */
  canImport: boolean;
  /** `gis.export` — hides the per-layer export action (task 2.8). */
  canExport: boolean;
  /** An unsaved geometry edit is open — switching target or deleting would strand it. */
  editLocked: boolean;
  /** The drawn-layer registry is still loading. */
  layersLoading: boolean;
  /** The registry failed to load — «Мои слои» says so instead of looking empty. */
  layersError: boolean;
  onRetryLayers: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onToggle: (layerId: string, visible: boolean) => void;
  onOpacity: (layerId: string, opacity: number) => void;
  onZoom: (def: MapLayerDef) => void;
  onActiveLayerChange: (layerId: string | null) => void;
  onCreateLayer: () => void;
  onImportLayer: () => void;
  onExportLayer: (def: MapLayerDef) => void;
  onDeleteLayer: (def: MapLayerDef) => void;
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
  isDrawTarget,
  editLocked,
  canExport,
  onToggle,
  onOpacity,
  onZoom,
  onActiveLayerChange,
  onExportLayer,
  onDeleteLayer,
}: {
  def: MapLayerDef;
  state: LayerState;
  isDrawTarget: boolean;
  editLocked: boolean;
  canExport: boolean;
  onToggle: LayersPanelProps['onToggle'];
  onOpacity: LayersPanelProps['onOpacity'];
  onZoom: LayersPanelProps['onZoom'];
  onActiveLayerChange: LayersPanelProps['onActiveLayerChange'];
  onExportLayer: LayersPanelProps['onExportLayer'];
  onDeleteLayer: LayersPanelProps['onDeleteLayer'];
}): React.JSX.Element {
  const { t } = useTranslation('map');
  const drawn = def.drawn;
  const registry = registryLayer(def);
  const title = def.title ?? (def.titleKey ? t(def.titleKey) : def.id);

  return (
    <li className="rounded-sm px-2 py-1.5 hover:bg-surface-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`layer-${def.id}`}
          checked={state.visible}
          onCheckedChange={(checked) => onToggle(def.id, checked === true)}
          aria-label={title}
        />
        {registry && (
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ background: def.color ?? `var(${def.colorToken})` }}
          />
        )}
        <label
          htmlFor={`layer-${def.id}`}
          className="flex-1 cursor-pointer truncate text-sm text-text"
        >
          {title}
        </label>
        {drawn?.canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-6 text-text-muted', isDrawTarget && 'bg-primary/10 text-primary')}
            aria-pressed={isDrawTarget}
            disabled={editLocked}
            onClick={() => onActiveLayerChange(isDrawTarget ? null : drawn.id)}
            aria-label={t('drawn.drawInto', { name: title })}
            title={t('drawn.drawInto', { name: title })}
            data-testid={`draw-target-${drawn.id}`}
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        {registry && canExport && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-text-muted"
            onClick={() => onExportLayer(def)}
            aria-label={t('export.layer', { name: title })}
            title={t('export.layer', { name: title })}
            data-testid={`export-layer-${registry.id}`}
          >
            <Download className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-text-muted"
          onClick={() => onZoom(def)}
          aria-label={t('panel.zoomToLayer', { name: title })}
          title={t('panel.zoomToLayer', { name: title })}
        >
          <Crosshair className="size-3.5" />
        </Button>
        {registry?.canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-text-muted hover:text-danger"
            disabled={editLocked}
            onClick={() => onDeleteLayer(def)}
            aria-label={t('drawn.deleteLayer', { name: title })}
            title={t('drawn.deleteLayer', { name: title })}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
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
 * visibility checkboxes, opacity, legends, and zoom-to-layer. «Мои слои» lists
 * the user's drawn layers — each can be made the drawing target (pencil), and
 * its manager can delete it. Collapsible to give the map full width.
 */
export function LayersPanel({
  states,
  availableSources,
  drawnDefs,
  activeLayerId,
  canCreateLayer,
  canImport,
  canExport,
  editLocked,
  layersLoading,
  layersError,
  onRetryLayers,
  collapsed,
  onCollapsedChange,
  onToggle,
  onOpacity,
  onZoom,
  onActiveLayerChange,
  onCreateLayer,
  onImportLayer,
  onExportLayer,
  onDeleteLayer,
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

  // An imported layer's MapLibre source is its own (`imported:<id>`), but its tiles
  // come from the shared `imported_mvt` function source — that is what the catalog
  // publishes, so that is what availability is checked against.
  const available = [...SYSTEM_LAYERS, ...drawnDefs].filter(
    (def) => !availableSources || availableSources.has(def.tileSource ?? def.source),
  );
  const groups = PANEL_GROUP_ORDER.map((group) => ({
    group,
    layers: available.filter((def) => def.group === group),
  })).filter(
    (entry) => entry.layers.length > 0 || (entry.group === 'mine' && (canCreateLayer || canImport)),
  );

  const renderGroup = (group: LayerGroup, layers: MapLayerDef[]): React.JSX.Element => (
    <section key={group} className="mb-2 last:mb-0">
      <div className="flex items-center justify-between px-2 py-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t(`groups.${group}`)}
        </h3>
        {group === 'mine' && (
          <div className="flex items-center gap-0.5">
            {canImport && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-text-muted"
                onClick={onImportLayer}
                aria-label={t('import.title')}
                title={t('import.title')}
                data-testid="import-layer"
              >
                <FileUp className="size-3.5" />
              </Button>
            )}
            {canCreateLayer && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-text-muted"
                onClick={onCreateLayer}
                aria-label={t('drawn.newLayer')}
                title={t('drawn.newLayer')}
                data-testid="create-layer"
              >
                <Plus className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      {group === 'mine' && layersError ? (
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <span className="text-xs text-danger">{t('drawn.loadFailed')}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onRetryLayers}>
            {t('drawn.retry')}
          </Button>
        </div>
      ) : group === 'mine' && layersLoading ? (
        <div className="space-y-1 px-2 pb-1">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : layers.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-text-muted">{t('drawn.empty')}</p>
      ) : (
        <ul>
          {layers.map((def) => (
            <LayerRow
              key={def.id}
              def={def}
              state={states[def.id] ?? { visible: def.defaultVisible, opacity: 1 }}
              isDrawTarget={def.drawn?.id === activeLayerId}
              editLocked={editLocked}
              canExport={canExport}
              onToggle={onToggle}
              onOpacity={onOpacity}
              onZoom={onZoom}
              onActiveLayerChange={onActiveLayerChange}
              onExportLayer={onExportLayer}
              onDeleteLayer={onDeleteLayer}
            />
          ))}
        </ul>
      )}
    </section>
  );

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
          groups.map(({ group, layers }) => renderGroup(group, layers))
        )}
      </div>
    </div>
  );
}
