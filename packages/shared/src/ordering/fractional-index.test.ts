import { describe, expect, it } from 'vitest';
import { isValidOrderKey, keyBetween, keysBetween } from './fractional-index';

describe('keyBetween', () => {
  it('produces a key between two ends of the list', () => {
    const first = keyBetween(null, null);
    expect(isValidOrderKey(first)).toBe(true);
  });

  it('a prepended key sorts before, an appended key sorts after', () => {
    const k = keyBetween(null, null);
    const before = keyBetween(null, k);
    const after = keyBetween(k, null);
    expect(before < k).toBe(true);
    expect(k < after).toBe(true);
  });

  it('an inserted key sorts strictly between its neighbours', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const mid = keyBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    expect(isValidOrderKey(mid)).toBe(true);
  });

  it('rejects reversed or equal bounds', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow();
    expect(() => keyBetween(a, a)).toThrow();
  });

  it('rejects a malformed bound (trailing zero / unknown digit)', () => {
    expect(() => keyBetween('A0', null)).toThrow();
    expect(() => keyBetween('!', null)).toThrow();
    expect(isValidOrderKey('A0')).toBe(false);
  });

  it('keeps sorted order through many sequential appends', () => {
    const keys: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      const k = keyBetween(prev, null);
      keys.push(k);
      prev = k;
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps sorted order through repeated inserts at the front', () => {
    const keys: string[] = [];
    let head: string | null = null;
    for (let i = 0; i < 100; i += 1) {
      const k = keyBetween(null, head);
      keys.unshift(k);
      head = k;
    }
    expect([...keys].sort()).toEqual(keys);
  });

  it('stays consistent through repeated midpoint insertions', () => {
    // Repeatedly insert between the same two neighbours: each new key must land between them.
    let lo = keyBetween(null, null);
    let hi = keyBetween(lo, null);
    for (let i = 0; i < 100; i += 1) {
      const mid = keyBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      // Alternate which side we keep to exercise both prefixes.
      if (i % 2 === 0) hi = mid;
      else lo = mid;
    }
  });
});

describe('keysBetween', () => {
  it('returns count keys in ascending order between the bounds', () => {
    const keys = keysBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(5);
    for (const k of keys) expect(isValidOrderKey(k)).toBe(true);
  });

  it('nests correctly between existing keys', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const keys = keysBetween(a, b, 4);
    expect([a, ...keys, b]).toEqual([a, ...keys, b].slice().sort());
  });

  it('handles the empty and single cases', () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
    expect(keysBetween(null, null, 1)).toHaveLength(1);
  });
});
