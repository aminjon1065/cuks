import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPinned, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@cuks/ui';
import { useCan } from '@/lib/ability';
import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import { useMartinCatalog, useTileToken } from '../api/queries';
import { defaultLayerStates, type LayerState } from '../lib/layers';
import { modeToOverride, type BasemapMode } from '../lib/basemap';
import { MapView, type MapViewHandle } from '../components/MapView';
import { LayersPanel } from '../components/LayersPanel';
import { BasemapSwitcher } from '../components/BasemapSwitcher';

const PANEL_KEY = 'cuks-map-panel-collapsed';

/**
 * Map explorer (`/app/map`, docs/modules/10 §4). Full-bleed MapLibre map with a
 * layer panel and basemap switcher. Vector layers come from Martin; the tile
 * token is fetched up front so every tile request is authorized (dev skips the
 * gate, prod enforces via Caddy). The incidents layer + timeline arrive in 2.4.
 */
export function MapPage(): React.JSX.Element {
  const { t } = useTranslation('map');
  const canView = useCan('gis.view');

  const tokenQuery = useTileToken();
  const catalogQuery = useMartinCatalog(tokenQuery.data?.token);

  // Keep the freshest token in a ref (read per tile request). Assigned during
  // render — not in an effect — so it is already set when MapView's init effect
  // creates the map; child effects run before this component's effects would, so
  // an effect here would leave the first tile requests token-less (401 in prod).
  const tokenRef = useRef<string | null>(null);
  if (tokenQuery.data) tokenRef.current = tokenQuery.data.token;
  const getToken = useCallback(() => tokenRef.current, []);

  const [states, setStates] = useState<Record<string, LayerState>>(() => defaultLayerStates());
  const [basemapMode, setBasemapMode] = useState<BasemapMode>('auto');
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(PANEL_KEY) === '1',
  );
  const collapsePanel = useCallback((collapsed: boolean) => {
    setPanelCollapsed(collapsed);
    localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  }, []);

  const mapRef = useRef<MapViewHandle | null>(null);

  const toggleLayer = useCallback((layerId: string, visible: boolean) => {
    setStates((prev) => ({ ...prev, [layerId]: { ...prev[layerId]!, visible } }));
  }, []);
  const setOpacity = useCallback((layerId: string, opacity: number) => {
    setStates((prev) => ({ ...prev, [layerId]: { ...prev[layerId]!, opacity } }));
  }, []);
  const zoomToLayer = useCallback((source: string) => {
    void mapRef.current?.zoomToLayer(source);
  }, []);

  useEffect(() => {
    document.title = t('title');
  }, [t]);

  if (!canView) return <ForbiddenPage />;

  const loading = tokenQuery.isPending || catalogQuery.isPending;
  const failed = tokenQuery.isError || catalogQuery.isError;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {loading && <Skeleton className="absolute inset-0 rounded-none" data-testid="map-loading" />}

      {!loading && failed && (
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

      {!loading && !failed && catalogQuery.data && (
        <>
          <MapView
            ref={mapRef}
            basemapOverride={modeToOverride(basemapMode)}
            states={states}
            availableSources={catalogQuery.data}
            getToken={getToken}
          />
          <LayersPanel
            states={states}
            availableSources={catalogQuery.data}
            collapsed={panelCollapsed}
            onCollapsedChange={collapsePanel}
            onToggle={toggleLayer}
            onOpacity={setOpacity}
            onZoom={zoomToLayer}
          />
          <BasemapSwitcher value={basemapMode} onChange={setBasemapMode} />
          {catalogQuery.data.size === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-text-muted shadow-[var(--shadow-1)]">
                <MapPinned className="size-4" />
                {t('empty.noSources')}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
