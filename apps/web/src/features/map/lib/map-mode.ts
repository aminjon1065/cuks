/** Map explorer mode: duty (ops-first) vs full GIS tools. */
export type MapExplorerMode = 'duty' | 'gis';

export const MAP_MODE_KEY = 'cuks-map-mode';

export function readStoredMapMode(): MapExplorerMode {
  if (typeof localStorage === 'undefined') return 'duty';
  return localStorage.getItem(MAP_MODE_KEY) === 'gis' ? 'gis' : 'duty';
}

export function storeMapMode(mode: MapExplorerMode): void {
  localStorage.setItem(MAP_MODE_KEY, mode);
}
