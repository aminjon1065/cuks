import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPinned, TriangleAlert } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Skeleton, toast } from '@cuks/ui';
import type { GeoJsonGeometry } from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { useSocketEvent } from '@/lib/socket';
import { ApiError } from '@/lib/api-client';
import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import {
  fetchGisFeature,
  fetchGisFeatures,
  useCreateGisFeature,
  useDeleteGisFeature,
  useDeleteGisLayer,
  useGisLayers,
  useIncidentMapFilterOptions,
  useMartinCatalog,
  usePatchGisFeature,
  useTileToken,
} from '../api/queries';
import {
  defaultLayerStates,
  drawnLayerDefs,
  type LayerState,
  type MapLayerDef,
} from '../lib/layers';
import {
  buildIncidentTileQuery,
  defaultIncidentFilters,
  type IncidentFilterState,
} from '../lib/incident-filters';
import { modeToOverride, type BasemapMode } from '../lib/basemap';
import { geometriesBounds, sameGeometry } from '../lib/geo';
import type { DrawTool } from '../lib/draw';
import type { InspectedFeature } from '../lib/inspect';
import { MapView, type EditingFeature, type MapViewHandle } from '../components/MapView';
import { LayersPanel } from '../components/LayersPanel';
import { BasemapSwitcher } from '../components/BasemapSwitcher';
import { IncidentFilterBar } from '../components/IncidentFilterBar';
import { IncidentTimeline } from '../components/IncidentTimeline';
import { MapInspector } from '../components/MapInspector';
import { DrawToolbar } from '../components/DrawToolbar';
import { CreateLayerDialog } from '../components/CreateLayerDialog';

const PANEL_KEY = 'cuks-map-panel-collapsed';
const DEFAULT_DRAW_COLOR = '#15803d';
/** `gisFeaturesQuerySchema` caps a page at 1000 features. */
const FEATURE_PAGE_MAX = 1000;

/** What the confirm dialog is about to destroy. */
type PendingDelete =
  { kind: 'feature'; feature: InspectedFeature } | { kind: 'layer'; def: MapLayerDef };

/**
 * Map explorer (`/app/map`, docs/modules/10 §4). Full-bleed MapLibre map with a
 * layer panel and basemap switcher. Vector layers come from Martin; the tile
 * token is fetched up front so every tile request is authorized (dev skips the
 * gate, prod enforces via Caddy). The operational incident layer is filtered by
 * reference-data controls and the bottom timeline without recreating the map.
 *
 * Task 2.7 adds the object inspector (click / shift+drag box → peek card) and the
 * drawn layers: a layer the user creates becomes the drawing target, terra-draw
 * captures the geometry, and the API persists it — every write goes through the
 * server's per-layer ACL, so the map only ever hides what would be rejected.
 */
export function MapPage(): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const canView = useCan('gis.view');
  // docs/05: creating/configuring a layer is `gis.layers.manage`; editing the
  // objects on it is `gis.layers.edit`. The server enforces both.
  const canManageLayers = useCan('gis.layers.manage');

  const tokenQuery = useTileToken();
  const catalogQuery = useMartinCatalog(tokenQuery.data?.token);
  const filterOptionsQuery = useIncidentMapFilterOptions();
  const layersQuery = useGisLayers();

  // Keep the freshest token in a ref (read per tile request). Assigned during
  // render — not in an effect — so it is already set when MapView's init effect
  // creates the map; child effects run before this component's effects would, so
  // an effect here would leave the first tile requests token-less (401 in prod).
  const tokenRef = useRef<string | null>(null);
  if (tokenQuery.data) tokenRef.current = tokenQuery.data.token;
  const getToken = useCallback(() => tokenRef.current, []);

  const [states, setStates] = useState<Record<string, LayerState>>(() => defaultLayerStates());
  const [basemapMode, setBasemapMode] = useState<BasemapMode>('auto');
  const [incidentFilters, setIncidentFilters] = useState<IncidentFilterState>(() =>
    defaultIncidentFilters(),
  );
  const [incidentRevision, setIncidentRevision] = useState(0);
  const incidentTileQuery = useMemo(
    () => `${buildIncidentTileQuery(incidentFilters)}&revision=${incidentRevision}`,
    [incidentFilters, incidentRevision],
  );
  useSocketEvent(
    'incidents.updated',
    useCallback(() => setIncidentRevision((value) => value + 1), []),
  );
  const resetIncidentFilters = useCallback(() => {
    setIncidentFilters(defaultIncidentFilters());
  }, []);
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(PANEL_KEY) === '1',
  );
  const collapsePanel = useCallback((collapsed: boolean) => {
    setPanelCollapsed(collapsed);
    localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  }, []);

  const mapRef = useRef<MapViewHandle | null>(null);

  // --- Drawn layers, drawing and the inspector (task 2.7) ---

  const layers = useMemo(() => layersQuery.data ?? [], [layersQuery.data]);
  const drawnDefs = useMemo(() => drawnLayerDefs(layers), [layers]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawTool>('none');
  const [drawnRevision, setDrawnRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [selection, setSelection] = useState<InspectedFeature[]>([]);
  const [selected, setSelected] = useState<InspectedFeature | null>(null);
  const [editing, setEditing] = useState<EditingFeature | null>(null);
  const [pendingGeometry, setPendingGeometry] = useState<GeoJsonGeometry | null>(null);

  const createFeature = useCreateGisFeature();
  const patchFeature = usePatchGisFeature();
  const deleteFeature = useDeleteGisFeature();
  const deleteLayer = useDeleteGisLayer();

  // The inspector's own selection, read by callbacks that outlive the render that
  // started them (the edit fetch below).
  const selectedRef = useRef<InspectedFeature | null>(null);
  selectedRef.current = selected;

  const activeLayer = layers.find((layer) => layer.id === activeLayerId && layer.canEdit) ?? null;
  const activeDef = drawnDefs.find((def) => def.drawn?.id === activeLayer?.id);
  const drawColor = activeDef?.color ?? DEFAULT_DRAW_COLOR;
  const busy = createFeature.isPending || patchFeature.isPending || deleteFeature.isPending;

  // Server errors carry a stable code (docs/04 §REST); the message is an English
  // log line, so the user gets the localized text for the codes we know and a
  // localized fallback for the rest.
  const failed = (error: unknown, fallback: string): void => {
    const code = error instanceof ApiError ? error.code : null;
    const key = code ? `errors.${code}` : null;
    const localized = key && i18n.exists(`map:${key}`) ? t(key) : t(fallback);
    toast({ title: localized, tone: 'danger' });
  };

  /** What the confirm dialog is about to destroy, by name. */
  const deleteTargetName =
    pendingDelete?.kind === 'layer'
      ? pendingDelete.def.title
      : pendingDelete?.kind === 'feature'
        ? pendingDelete.feature.title || undefined
        : undefined;

  // A layer that is gone (deleted elsewhere, access revoked) can't be drawn into.
  useEffect(() => {
    if (activeLayerId && !activeLayer) {
      setActiveLayerId(null);
      setTool('none');
    }
  }, [activeLayer, activeLayerId]);

  const closeInspector = useCallback(() => {
    setSelection([]);
    setSelected(null);
    setEditing(null);
    setPendingGeometry(null);
  }, []);

  // The card opens on the topmost object (a click always also hits the admin unit
  // under it); anything else the click or box caught stays one «Назад» away.
  const onInspect = useCallback((features: InspectedFeature[]) => {
    setSelection(features);
    setSelected(features[0] ?? null);
  }, []);

  const onDrawFinish = useCallback(
    (geometry: GeoJsonGeometry) => {
      if (!activeLayer) return;
      createFeature.mutate(
        { layerId: activeLayer.id, geometry, props: {} },
        {
          onSuccess: () => {
            setDrawnRevision((value) => value + 1);
            toast({ title: t('draw.created'), tone: 'success' });
          },
          onError: (error) => failed(error, 'draw.createFailed'),
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is a stable local
    [activeLayer, createFeature, t],
  );

  // The fetch is not instant, and the map stays live while it runs: if the user has
  // moved on to another object by the time it lands, the geometry that comes back is
  // not the one on screen — drop it rather than open an editor over the wrong feature.
  const startEdit = useCallback(
    (feature: InspectedFeature) => {
      void fetchGisFeature(feature.id)
        .then((stored) => {
          if (selectedRef.current?.id !== feature.id) return;
          setEditing({ id: stored.id, geometry: stored.geometry });
          setPendingGeometry(null);
          setTool('select');
        })
        .catch((error: unknown) => failed(error, 'draw.editFailed'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is a stable local
    [t],
  );

  // Terra-draw reports an update when the feature is merely selected, so an edit
  // only counts once the geometry actually differs from what is stored.
  const onEditGeometry = useCallback(
    (geometry: GeoJsonGeometry) => {
      setPendingGeometry(sameGeometry(editing?.geometry, geometry) ? null : geometry);
    },
    [editing],
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setPendingGeometry(null);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editing || !pendingGeometry) return;
    patchFeature.mutate(
      { id: editing.id, input: { geometry: pendingGeometry } },
      {
        onSuccess: () => {
          setEditing(null);
          setPendingGeometry(null);
          setDrawnRevision((value) => value + 1);
          toast({ title: t('draw.saved'), tone: 'success' });
        },
        onError: (error) => failed(error, 'draw.saveFailed'),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is a stable local
  }, [editing, patchFeature, pendingGeometry, t]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'feature') {
      deleteFeature.mutate(pendingDelete.feature.id, {
        onSuccess: () => {
          setPendingDelete(null);
          setDrawnRevision((value) => value + 1);
          closeInspector();
          toast({ title: t('draw.deleted'), tone: 'success' });
        },
        onError: (error) => failed(error, 'draw.deleteFailed'),
      });
      return;
    }
    const layerId = pendingDelete.def.drawn?.id;
    if (!layerId) return;
    deleteLayer.mutate(layerId, {
      onSuccess: () => {
        setPendingDelete(null);
        if (activeLayerId === layerId) {
          setActiveLayerId(null);
          setTool('none');
        }
        closeInspector();
        toast({ title: t('drawn.deleted'), tone: 'success' });
      },
      onError: (error) => failed(error, 'drawn.deleteFailed'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is a stable local
  }, [activeLayerId, closeInspector, deleteFeature, deleteLayer, pendingDelete, t]);

  const toggleLayer = useCallback((layerId: string, visible: boolean) => {
    setStates((prev) => ({
      ...prev,
      [layerId]: { opacity: prev[layerId]?.opacity ?? 1, visible },
    }));
  }, []);
  const setOpacity = useCallback((layerId: string, opacity: number) => {
    setStates((prev) => ({
      ...prev,
      [layerId]: { visible: prev[layerId]?.visible ?? true, opacity },
    }));
  }, []);

  // Drawn layers all share one Martin source, so its bounds would cover every
  // layer at once — zoom to the layer's own features instead.
  const zoomToLayer = useCallback(
    (def: MapLayerDef) => {
      const drawn = def.drawn;
      if (!drawn) {
        void mapRef.current?.zoomToLayer(def.source);
        return;
      }
      void fetchGisFeatures(drawn.id, FEATURE_PAGE_MAX)
        .then((features) => {
          const bounds = geometriesBounds(features.map((feature) => feature.geometry));
          if (!bounds) {
            toast({ title: t('drawn.noFeatures') });
            return;
          }
          // The features endpoint is paged; a layer bigger than one page zooms to the
          // newest slice of it — say so rather than pretend it covers everything.
          if (features.length === FEATURE_PAGE_MAX) {
            toast({ title: t('drawn.zoomTruncated', { count: FEATURE_PAGE_MAX }) });
          }
          mapRef.current?.fitBounds(bounds);
        })
        .catch((error: unknown) => failed(error, 'drawn.zoomFailed'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is a stable local
    [t],
  );

  const onCreated = useCallback((layerId: string) => {
    setActiveLayerId(layerId);
    setTool('none');
  }, []);

  useEffect(() => {
    document.title = t('title');
  }, [t]);

  // Escape backs out one step at a time: the geometry edit, then the drawing tool,
  // then the inspector.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (editing) cancelEdit();
      else if (tool !== 'none') setTool('none');
      else if (selection.length > 0) closeInspector();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelEdit, closeInspector, editing, selection.length, tool]);

  if (!canView) return <ForbiddenPage />;

  const loading = tokenQuery.isPending || catalogQuery.isPending;
  const mapFailed = tokenQuery.isError || catalogQuery.isError;
  const showToolbar = activeLayer !== null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {loading && <Skeleton className="absolute inset-0 rounded-none" data-testid="map-loading" />}

      {!loading && mapFailed && (
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState
            icon={TriangleAlert}
            title={t('error.title')}
            description={t('error.description')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void tokenQuery.refetch();
                  void catalogQuery.refetch();
                }}
              >
                {t('error.retry')}
              </Button>
            }
          />
        </div>
      )}

      {!loading && !mapFailed && catalogQuery.data && (
        <>
          <MapView
            ref={mapRef}
            basemapOverride={modeToOverride(basemapMode)}
            states={states}
            availableSources={catalogQuery.data}
            getToken={getToken}
            incidentTileQuery={incidentTileQuery}
            drawnDefs={drawnDefs}
            drawnRevision={drawnRevision}
            tool={tool}
            drawColor={drawColor}
            editing={editing}
            pendingGeometry={pendingGeometry}
            onDrawFinish={onDrawFinish}
            onEditGeometry={onEditGeometry}
            onInspect={onInspect}
          />
          <LayersPanel
            states={states}
            availableSources={catalogQuery.data}
            drawnDefs={drawnDefs}
            activeLayerId={activeLayerId}
            canCreateLayer={canManageLayers}
            editLocked={editing !== null}
            layersLoading={layersQuery.isPending}
            layersError={layersQuery.isError}
            onRetryLayers={() => void layersQuery.refetch()}
            collapsed={panelCollapsed}
            onCollapsedChange={collapsePanel}
            onToggle={toggleLayer}
            onOpacity={setOpacity}
            onZoom={zoomToLayer}
            onActiveLayerChange={(layerId) => {
              setActiveLayerId(layerId);
              if (!layerId) setTool('none');
            }}
            onCreateLayer={() => setCreateOpen(true)}
            onDeleteLayer={(def) => setPendingDelete({ kind: 'layer', def })}
          />
          <BasemapSwitcher value={basemapMode} onChange={setBasemapMode} />
          {showToolbar && (
            <DrawToolbar
              layerTitle={activeLayer.title}
              geometryType={activeLayer.geometryType}
              value={tool}
              onChange={setTool}
              locked={editing !== null}
            />
          )}
          <MapInspector
            features={selection}
            selected={selected}
            layers={layers}
            options={filterOptionsQuery.data}
            editing={editing !== null}
            dirty={pendingGeometry !== null}
            busy={busy}
            offsetRight={showToolbar}
            onSelect={setSelected}
            onClose={closeInspector}
            onEdit={startEdit}
            onSave={saveEdit}
            onCancelEdit={cancelEdit}
            onDelete={(feature) => setPendingDelete({ kind: 'feature', feature })}
          />
          {catalogQuery.data.has('incidents_mvt') && (
            <>
              <IncidentFilterBar
                value={incidentFilters}
                options={filterOptionsQuery.data}
                loading={filterOptionsQuery.isPending}
                error={filterOptionsQuery.isError}
                panelCollapsed={panelCollapsed}
                onChange={setIncidentFilters}
                onReset={resetIncidentFilters}
                onRetry={() => void filterOptionsQuery.refetch()}
              />
              <IncidentTimeline value={incidentFilters} onChange={setIncidentFilters} />
            </>
          )}
          {catalogQuery.data.size === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-text-muted shadow-[var(--shadow-1)]">
                <MapPinned className="size-4" />
                {t('empty.noSources')}
              </div>
            </div>
          )}
          <CreateLayerDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
          <ConfirmDialog
            open={pendingDelete !== null}
            onOpenChange={(open) => !open && setPendingDelete(null)}
            title={
              pendingDelete?.kind === 'layer' ? t('drawn.deleteLayerTitle') : t('draw.deleteTitle')
            }
            description={
              pendingDelete?.kind === 'layer'
                ? t('drawn.deleteLayerDescription')
                : t('draw.deleteDescription')
            }
            {...(deleteTargetName ? { entityName: deleteTargetName } : {})}
            confirmLabel={t('inspector.delete')}
            cancelLabel={t('inspector.cancel')}
            closeLabel={t('drawn.close')}
            loading={deleteFeature.isPending || deleteLayer.isPending}
            destructive
            onConfirm={confirmDelete}
          />
        </>
      )}
    </div>
  );
}
