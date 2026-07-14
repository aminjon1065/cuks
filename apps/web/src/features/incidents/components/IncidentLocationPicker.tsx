import { useEffect, useRef } from 'react';
import { Map as MlMap, Marker, NavigationControl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { IncidentLocationInput } from '@cuks/shared';

const DEFAULT_CENTER: [number, number] = [68.787, 38.559];

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function emptyStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': token('--surface-2') },
      },
    ],
  };
}

/** Lightweight MapLibre mini-map used for point selection and card overview. */
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

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const map = new MlMap({
      container: el,
      style: emptyStyle(),
      center: Number.isFinite(value.longitude) ? [value.longitude, value.latitude] : DEFAULT_CENTER,
      zoom: 8,
      attributionControl: false,
      cooperativeGestures: true,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    const primary = token('--primary');
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
    // MapLibre styles are concrete values, whereas the app theme uses CSS tokens.
    // Rebuild this tiny no-network style when the document theme changes.
    const themeObserver = new MutationObserver(() => map.setStyle(emptyStyle()));
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
    // Map owns mutable state after initialization; only the marker changes below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
