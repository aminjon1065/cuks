import { describe, expect, it } from 'vitest';
import { defaultMapPngName } from './map-snapshot';

describe('defaultMapPngName', () => {
  it('builds a dated filename', () => {
    const name = defaultMapPngName(new Date(2026, 6, 28, 21, 5));
    expect(name).toBe('cuks-map-20260728-2105.png');
  });
});
