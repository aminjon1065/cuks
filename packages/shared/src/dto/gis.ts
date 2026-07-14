/** Tile-access token issued on map load (docs/modules/10 §9). The client appends
 *  it as `?token=` to Martin tile requests; Caddy forward_auth validates it. */
export interface TileTokenResponse {
  token: string;
  /** ISO instant the token expires. */
  expiresAt: string;
}

/** Selectable leaf in the incident-type dictionary tree. Parent metadata lets
 * the map UI present the flat select as a readable grouped hierarchy. */
export interface IncidentTypeFilterOption {
  code: string;
  parentCode: string | null;
  nameRu: string;
  nameTg: string;
  parentNameRu: string | null;
  parentNameTg: string | null;
}

/** Administrative region available to the incident map filter. */
export interface IncidentRegionFilterOption {
  id: string;
  code: string;
  nameRu: string;
  nameTg: string;
}

/** Reference data for `/gis/incidents/filter-options`. */
export interface IncidentMapFilterOptionsResponse {
  types: IncidentTypeFilterOption[];
  regions: IncidentRegionFilterOption[];
}
