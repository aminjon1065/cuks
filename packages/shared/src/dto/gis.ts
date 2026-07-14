/** Tile-access token issued on map load (docs/modules/10 §9). The client appends
 *  it as `?token=` to Martin tile requests; Caddy forward_auth validates it. */
export interface TileTokenResponse {
  token: string;
  /** ISO instant the token expires. */
  expiresAt: string;
}
