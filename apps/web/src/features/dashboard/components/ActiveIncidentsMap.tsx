import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import type { ActiveIncidentPoint } from '@cuks/shared';
import {
  INITIAL_CENTER,
  INITIAL_ZOOM,
  TAJIKISTAN_BOUNDS,
  cssToken,
} from '@/features/map/lib/map-config';
import 'maplibre-gl/dist/maplibre-gl.css';

const SOURCE_ID = 'active-incidents';
const LAYER_ID = 'active-incidents-points';

/** Circle colour by severity, on the `--sev-N` scale (docs/06 §2). Resolved once
 *  at init against the active theme. */
function severityColor(): maplibregl.ExpressionSpecification {
  return [
    'match',
    ['get', 'severity'],
    1,
    cssToken('--sev-1', '#64748b'),
    2,
    cssToken('--sev-2', '#ca8a04'),
    3,
    cssToken('--sev-3', '#ea580c'),
    4,
    cssToken('--sev-4', '#dc2626'),
    5,
    cssToken('--sev-5', '#7f1d1d'),
    cssToken('--sev-1', '#64748b'),
  ];
}

function toFeatureCollection(points: ActiveIncidentPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      properties: { id: point.id, number: point.number, severity: point.severity },
    })),
  };
}

/**
 * Lightweight active-incidents inset (docs/modules/10 §8). A neutral-background
 * MapLibre map with the incident points as a severity-coloured circle layer — no
 * PMTiles/tile-token dependency, and lazy-loaded so maplibre-gl stays out of the
 * dashboard's initial bundle. Clicking a point opens its incident card.
 */
export default function ActiveIncidentsMap({
  points,
}: {
  points: ActiveIncidentPoint[];
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const navigate = useNavigate();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'bg',
          type: 'background',
          paint: { 'background-color': cssToken('--surface-2', '#f1f5f9') },
        },
      ],
    };
    const map = new maplibregl.Map({
      container,
      style,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
      // Don't hijack page scroll from an inset; panning/zoom controls remain.
      scrollZoom: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource(SOURCE_ID, { type: 'geojson', data: toFeatureCollection(pointsRef.current) });
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 11, 9],
          'circle-color': severityColor(),
          'circle-stroke-width': 1.5,
          'circle-stroke-color': cssToken('--surface', '#ffffff'),
        },
      });
      map.fitBounds(TAJIKISTAN_BOUNDS, { padding: 24, duration: 0 });
    });

    map.on('click', LAYER_ID, (event) => {
      const id = event.features?.[0]?.properties?.['id'];
      if (typeof id === 'string') navigate(`/app/incidents/${id}`);
    });
    map.on('mouseenter', LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });

    // The style's colours are resolved from CSS tokens at init; re-apply them when
    // the app theme (a class on <html>) toggles, so the inset follows light/dark.
    const applyThemeColors = (): void => {
      if (!map.isStyleLoaded()) return;
      map.setPaintProperty('bg', 'background-color', cssToken('--surface-2', '#f1f5f9'));
      if (map.getLayer(LAYER_ID)) {
        // Re-resolve the severity fill too — the --sev-N tokens differ per theme.
        map.setPaintProperty(LAYER_ID, 'circle-color', severityColor());
        map.setPaintProperty(LAYER_ID, 'circle-stroke-color', cssToken('--surface', '#ffffff'));
      }
    };
    const themeObserver = new MutationObserver(applyThemeColors);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      themeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [navigate]);

  // Keep the source in step when the period (and so the point set) changes.
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(toFeatureCollection(points));
  }, [points]);

  return <div ref={containerRef} className="size-full" />;
}
