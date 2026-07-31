import { INCIDENT_STATUSES } from '@cuks/shared';
import type { BasemapMode } from './basemap';
import type { IncidentFilterState, IncidentMapStatusFilter } from './incident-filters';
import type { LayerState } from './layers';
import type { MapExplorerMode } from './map-mode';

/** Schema version written into `?view=`. Bump when the param contract changes. */
export const MAP_VIEW_VERSION = 1;

/** Query keys owned by the shared map view (docs/modules/10 §4). */
export const MAP_VIEW_PARAM_KEYS = [
  'view',
  'mode',
  'basemap',
  'c',
  'z',
  'layers',
  'status',
  'type',
  'region',
  'from',
  'to',
  'cursor',
] as const;

export type MapCamera = {
  center: [number, number];
  zoom: number;
};

type ParsedFilters = {
  typeCode: string;
  /** `undefined` = key absent → keep the mode default on hydrate. */
  status: IncidentMapStatusFilter | undefined;
  regionId: string;
  dateFrom: string | null;
  dateTo: string | null;
  cursorDate: string | null;
};

/** Serializable snapshot of the explorer a colleague should reopen. */
export type MapViewSnapshot = {
  version: typeof MAP_VIEW_VERSION;
  mode: MapExplorerMode;
  basemap: BasemapMode;
  camera: MapCamera;
  layers: Record<string, LayerState>;
  filters: IncidentFilterState;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_SET = new Set<string>(['open', ...INCIDENT_STATUSES]);

/**
 * Read a shared map view from the current search params. Returns `null` when
 * `view` is absent or the payload is unusable — the page then keeps its defaults.
 */
export function parseMapViewSearchParams(
  params: URLSearchParams,
): (Omit<MapViewSnapshot, 'filters'> & { filters: ParsedFilters }) | null {
  if (params.get('view') !== String(MAP_VIEW_VERSION)) return null;

  const mode = parseMode(params.get('mode'));
  const basemap = parseBasemap(params.get('basemap'));
  const camera = parseCamera(params.get('c'), params.get('z'));
  if (!mode || !basemap || !camera) return null;

  return {
    version: MAP_VIEW_VERSION,
    mode,
    basemap,
    camera,
    layers: parseLayers(params.get('layers')),
    filters: parseFilters(params),
  };
}

/** Fill missing filter fields from the mode's usual defaults. */
export function coalesceMapFilters(
  parsed: ParsedFilters,
  defaults: IncidentFilterState,
): IncidentFilterState {
  const dateTo = parsed.dateTo ?? defaults.dateTo;
  return {
    typeCode: parsed.typeCode,
    status: parsed.status === undefined ? defaults.status : parsed.status,
    regionId: parsed.regionId,
    dateFrom: parsed.dateFrom ?? defaults.dateFrom,
    dateTo,
    cursorDate: parsed.cursorDate ?? dateTo,
  };
}

/** Write a snapshot into a copy of `base`, replacing prior map-view keys. */
export function writeMapViewSearchParams(
  base: URLSearchParams,
  snapshot: MapViewSnapshot,
): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of MAP_VIEW_PARAM_KEYS) next.delete(key);

  next.set('view', String(MAP_VIEW_VERSION));
  next.set('mode', snapshot.mode);
  next.set('basemap', snapshot.basemap);
  next.set('c', `${snapshot.camera.center[0].toFixed(5)},${snapshot.camera.center[1].toFixed(5)}`);
  next.set('z', (Math.round(snapshot.camera.zoom * 100) / 100).toString());
  const layers = encodeLayers(snapshot.layers);
  if (layers) next.set('layers', layers);

  const { filters } = snapshot;
  if (filters.typeCode) next.set('type', filters.typeCode);
  if (filters.status) next.set('status', filters.status);
  if (filters.regionId) next.set('region', filters.regionId);
  next.set('from', filters.dateFrom);
  next.set('to', filters.dateTo);
  if (filters.cursorDate !== filters.dateTo) next.set('cursor', filters.cursorDate);
  return next;
}

/** Absolute permalink for the current path + view params. */
export function mapViewShareUrl(
  snapshot: MapViewSnapshot,
  base: URLSearchParams = new URLSearchParams(),
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): string {
  const params = writeMapViewSearchParams(base, snapshot);
  const query = params.toString();
  return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`;
}

/** Overlay shared layer toggles onto an existing state map. */
export function mergeLayerStates(
  base: Record<string, LayerState>,
  overlay: Record<string, LayerState>,
): Record<string, LayerState> {
  return { ...base, ...overlay };
}

function parseMode(value: string | null): MapExplorerMode | null {
  return value === 'duty' || value === 'gis' ? value : null;
}

function parseBasemap(value: string | null): BasemapMode | null {
  return value === 'auto' || value === 'light' || value === 'dark' ? value : null;
}

function parseCamera(c: string | null, z: string | null): MapCamera | null {
  if (!c || !z) return null;
  const parts = c.split(',');
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  const zoom = Number(z);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  if (zoom < 0 || zoom > 22) return null;
  return { center: [lon, lat], zoom };
}

/** `id:visible:opacityPct;…` — opacity is 0–100. */
function parseLayers(raw: string | null): Record<string, LayerState> {
  const out: Record<string, LayerState> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    if (!part) continue;
    const bits = part.split(':');
    if (bits.length !== 3) continue;
    const [id, visibleRaw, opacityRaw] = bits;
    if (!id) continue;
    const visible = visibleRaw === '1';
    const opacityPct = Number(opacityRaw);
    if (!Number.isFinite(opacityPct) || opacityPct < 0 || opacityPct > 100) continue;
    out[id] = { visible, opacity: opacityPct / 100 };
  }
  return out;
}

function encodeLayers(layers: Record<string, LayerState>): string {
  return Object.entries(layers)
    .map(([id, state]) => {
      const opacityPct = Math.round(Math.min(1, Math.max(0, state.opacity)) * 100);
      return `${id}:${state.visible ? 1 : 0}:${opacityPct}`;
    })
    .join(';');
}

function parseFilters(params: URLSearchParams): ParsedFilters {
  const statusRaw = params.get('status');
  let status: IncidentMapStatusFilter | undefined;
  if (statusRaw === null) status = undefined;
  else if (statusRaw === '' || STATUS_SET.has(statusRaw)) {
    status = statusRaw as IncidentMapStatusFilter;
  } else {
    status = undefined;
  }

  return {
    typeCode: params.get('type') ?? '',
    status,
    regionId: params.get('region') ?? '',
    dateFrom: parseDate(params.get('from')),
    dateTo: parseDate(params.get('to')),
    cursorDate: parseDate(params.get('cursor')),
  };
}

function parseDate(value: string | null): string | null {
  if (!value || !DATE_RE.test(value)) return null;
  return value;
}
