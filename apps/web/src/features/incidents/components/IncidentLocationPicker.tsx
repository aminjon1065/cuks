import { useEffect, useRef } from 'react';
import { Map as MlMap, Marker, NavigationControl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { IncidentLocationInput } from '@cuks/shared';
import { buildStyle, type BasemapFlavor } from '../../map/lib/basemap';
import { BASEMAP_SOURCE, cssToken } from '../../map/lib/map-config';
import { makeTransformRequest } from '../../map/lib/tiles';
import { useTileToken } from '../../map/api/queries';

const DEFAULT_CENTER: [number, number] = [68.787, 38.559];

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** Empty, no-network fallback (dev without a basemap, or before the tile token
 *  resolves): a plain themed background so the marker is never orphaned. */
function emptyStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': cssToken('--surface-2') },
      },
    ],
  };
}

/** The Protomaps basemap alone (no `gis.*` overlays): passing only `region` as the
 *  available source filters every system/registry layer out of `buildStyle`, so the
 *  card mini-map shows a real, self-hosted map under the incident marker. */
function basemapStyle(flavor: BasemapFlavor): StyleSpecification {
  return buildStyle({
    flavor,
    token: cssToken,
    states: {},
    availableSources: new Set([BASEMAP_SOURCE]),
  });
}

/** Lightweight MapLibre mini-map used for point selection and card overview. Shows
 *  the offline Protomaps basemap once the tile token is available, falling back to a
 *  plain themed background otherwise. */
export function IncidentLocationPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: IncidentLocationInput;
  onChange?: (location: IncidentLocationInput) => void;
  ariaLabel: string;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Short-lived tile token (docs/modules/10 §9); read through a ref so the map's
  // transformRequest always stamps the freshest value without a rebuild.
  const { data: tokenData } = useTileToken();
  const token = tokenData?.token ?? null;
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;
  const basemapAppliedRef = useRef(false);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // Start with the basemap when a token is already cached, else the empty style;
    // the token effect below upgrades an empty map once the token resolves.
    const withBasemap = !!tokenRef.current;
    basemapAppliedRef.current = withBasemap;
    const map = new MlMap({
      container: el,
      style: withBasemap ? basemapStyle(isDark() ? 'dark' : 'light') : emptyStyle(),
      center: Number.isFinite(value.longitude) ? [value.longitude, value.latitude] : DEFAULT_CENTER,
      zoom: 8,
      attributionControl: false,
      cooperativeGestures: true,
      transformRequest: makeTransformRequest(() => tokenRef.current),
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    const primary = cssToken('--primary');
    const marker = new Marker(primary ? { color: primary } : {})
      .setLngLat([value.longitude, value.latitude])
      .addTo(map);
    markerRef.current = marker;
    const click = (event: { lngLat: { lng: number; lat: number } }): void => {
      if (!onChangeRef.current) return;
      const location = { longitude: event.lngLat.lng, latitude: event.lngLat.lat };
      marker.setLngLat([location.longitude, location.latitude]);
      onChangeRef.current(location);
    };
    if (onChangeRef.current) {
      map.on('click', click);
      map.getCanvas().style.cursor = 'crosshair';
    }
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(el);
    // Rebuild the style (basemap or empty) when the document theme flips, so the
    // map follows light/dark. The marker is an overlay and survives setStyle.
    const themeObserver = new MutationObserver(() => {
      map.setStyle(
        basemapAppliedRef.current ? basemapStyle(isDark() ? 'dark' : 'light') : emptyStyle(),
      );
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      resize.disconnect();
      themeObserver.disconnect();
      map.off('click', click);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map owns mutable state after initialization; the effects below drive updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upgrade an empty map to the basemap the moment the tile token becomes available.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapAppliedRef.current || !token) return;
    basemapAppliedRef.current = true;
    map.setStyle(basemapStyle(isDark() ? 'dark' : 'light'));
  }, [token]);

  useEffect(() => {
    markerRef.current?.setLngLat([value.longitude, value.latitude]);
  }, [value.latitude, value.longitude]);

  return (
    <div
      ref={container}
      className="h-48 overflow-hidden rounded-md border border-border"
      aria-label={ariaLabel}
    />
  );
}
