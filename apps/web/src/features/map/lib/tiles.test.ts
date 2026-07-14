import { describe, expect, it } from 'vitest';
import { appendTileToken, makeTransformRequest } from './tiles';

describe('appendTileToken', () => {
  it('appends the token to a relative tile URL', () => {
    const out = appendTileToken('/tiles/admin_units/6/44/23', 'abc');
    expect(out).toContain('/tiles/admin_units/6/44/23');
    expect(out).toContain('token=abc');
  });

  it('appends the token to an absolute tile URL', () => {
    const out = appendTileToken('http://localhost/tiles/facilities/1/2/3', 'xyz');
    expect(new URL(out).searchParams.get('token')).toBe('xyz');
  });

  it('leaves non-tile URLs untouched', () => {
    expect(appendTileToken('/api/v1/gis/tile-token', 'abc')).toBe('/api/v1/gis/tile-token');
  });

  it('is a no-op without a token', () => {
    expect(appendTileToken('/tiles/x/1/2/3', null)).toBe('/tiles/x/1/2/3');
    expect(appendTileToken('/tiles/x/1/2/3', undefined)).toBe('/tiles/x/1/2/3');
  });
});

describe('makeTransformRequest', () => {
  it('rewrites tile requests with the current token', () => {
    const transform = makeTransformRequest(() => 'tok1');
    const result = transform('/tiles/risk_zones/3/4/5');
    expect(result?.url).toContain('token=tok1');
  });

  it('reads the token lazily so a refresh is picked up', () => {
    let token = 'first';
    const transform = makeTransformRequest(() => token);
    expect(transform('/tiles/x/1/2/3')?.url).toContain('token=first');
    token = 'second';
    expect(transform('/tiles/x/1/2/3')?.url).toContain('token=second');
  });

  it('passes non-tile requests through untouched', () => {
    const transform = makeTransformRequest(() => 'tok');
    expect(transform('/api/v1/anything')).toBeUndefined();
  });

  it('does not rewrite when there is no token', () => {
    const transform = makeTransformRequest(() => null);
    expect(transform('/tiles/x/1/2/3')).toBeUndefined();
  });
});
