import { describe, expect, it } from 'vitest';
import { incidentTileInScope } from './gis.controller';

/**
 * The tile-auth region gate (task 2.13). For a territory-confined token an
 * `incidents_mvt` request must carry exactly one `region` filter within scope.
 * The duplicate-param case is a confused-deputy bypass: this gate reads the FIRST
 * `region` value (URLSearchParams.get), while Martin resolves duplicate query keys
 * last-wins — so anything but a single value must be denied.
 */
const SCOPE = ['reg-a', 'reg-b'];
const tile = (qs: string) => `/incidents_mvt/9/355/196?${qs}`;

describe('incidentTileInScope', () => {
  it('passes non-incident tile sources (and missing uris) straight through', () => {
    expect(incidentTileInScope('/admin_units/6/44/24?region=reg-x', SCOPE)).toBe(true);
    expect(incidentTileInScope('/layer_features_mvt/9/1/2', SCOPE)).toBe(true);
    expect(incidentTileInScope(undefined, SCOPE)).toBe(true);
  });

  it('allows a single in-scope region', () => {
    expect(incidentTileInScope(tile('region=reg-a&from=1&to=2'), SCOPE)).toBe(true);
    expect(incidentTileInScope(tile('region=reg-b'), SCOPE)).toBe(true);
  });

  it('denies an out-of-scope region', () => {
    expect(incidentTileInScope(tile('region=reg-x'), SCOPE)).toBe(false);
  });

  it('denies a scoped incident tile with no region filter', () => {
    expect(incidentTileInScope(tile('from=1&to=2'), SCOPE)).toBe(false);
    expect(incidentTileInScope('/incidents_mvt/9/355/196', SCOPE)).toBe(false);
  });

  it('rejects duplicate region params (HTTP parameter pollution / confused deputy)', () => {
    // The first value is in scope (what this gate reads); the second is out of scope
    // (what Martin filters on, last-wins). Both orderings must be denied.
    expect(incidentTileInScope(tile('region=reg-a&region=reg-x'), SCOPE)).toBe(false);
    expect(incidentTileInScope(tile('region=reg-x&region=reg-a'), SCOPE)).toBe(false);
    // Even two in-scope values are rejected — exactly one is the only safe shape.
    expect(incidentTileInScope(tile('region=reg-a&region=reg-b'), SCOPE)).toBe(false);
  });
});
