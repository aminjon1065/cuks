import { describe, expect, it } from 'vitest';
import { parseCoordinates, pointBounds } from './place-search';

describe('parseCoordinates', () => {
  it('parses lat,lon inside Tajikistan', () => {
    expect(parseCoordinates('38.56, 68.78')).toEqual({ lat: 38.56, lon: 68.78 });
    expect(parseCoordinates('38.56;68.78')).toEqual({ lat: 38.56, lon: 68.78 });
  });

  it('parses lon,lat when that orientation fits Tajikistan better', () => {
    expect(parseCoordinates('68.78, 38.56')).toEqual({ lat: 38.56, lon: 68.78 });
  });

  it('honours N/E hemisphere letters', () => {
    expect(parseCoordinates('N38.56 E68.78')).toEqual({ lat: 38.56, lon: 68.78 });
    expect(parseCoordinates('38.56° N, 68.78° E')).toEqual({ lat: 38.56, lon: 68.78 });
  });

  it('rejects non-coordinate text', () => {
    expect(parseCoordinates('Бохтар')).toBeNull();
    expect(parseCoordinates('')).toBeNull();
    expect(parseCoordinates('999, 999')).toBeNull();
  });
});

describe('pointBounds', () => {
  it('pads a point into a fitBounds box', () => {
    const [west, south, east, north] = pointBounds(68.8, 38.5, 0.1);
    expect(west).toBeCloseTo(68.7);
    expect(south).toBeCloseTo(38.4);
    expect(east).toBeCloseTo(68.9);
    expect(north).toBeCloseTo(38.6);
  });
});
