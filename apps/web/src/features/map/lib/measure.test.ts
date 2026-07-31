import { describe, expect, it } from 'vitest';
import {
  closeRing,
  formatAreaSquareMeters,
  formatDistanceMeters,
  lineLengthMeters,
  measureCollection,
  measureReading,
  ringAreaSquareMeters,
} from './measure';

describe('lineLengthMeters', () => {
  it('returns 0 for fewer than two points', () => {
    expect(lineLengthMeters([])).toBe(0);
    expect(lineLengthMeters([[68.8, 38.5]])).toBe(0);
  });

  it('measures a short segment in Dushanbe (~1 km scale)', () => {
    // ~0.01° lon at 38.5°N ≈ 870 m
    const meters = lineLengthMeters([
      [68.78, 38.56],
      [68.79, 38.56],
    ]);
    expect(meters).toBeGreaterThan(700);
    expect(meters).toBeLessThan(1000);
  });
});

describe('ringAreaSquareMeters', () => {
  it('returns null until three vertices exist', () => {
    expect(
      ringAreaSquareMeters([
        [68.78, 38.56],
        [68.79, 38.56],
      ]),
    ).toBeNull();
  });

  it('computes a small rectangle area', () => {
    const m2 = ringAreaSquareMeters([
      [68.78, 38.56],
      [68.79, 38.56],
      [68.79, 38.57],
      [68.78, 38.57],
    ]);
    expect(m2).not.toBeNull();
    // ~0.01° × 0.01° ≈ 0.87 km × 1.11 km ≈ 0.97 km²
    expect(m2!).toBeGreaterThan(700_000);
    expect(m2!).toBeLessThan(1_200_000);
  });
});

describe('measureReading', () => {
  it('reports length for distance mode', () => {
    const reading = measureReading('distance', [
      [68.78, 38.56],
      [68.79, 38.56],
    ]);
    expect(reading.squareMeters).toBeNull();
    expect(reading.meters).toBeGreaterThan(0);
  });

  it('reports area once a ring can close', () => {
    const reading = measureReading('area', [
      [68.78, 38.56],
      [68.79, 38.56],
      [68.79, 38.57],
    ]);
    expect(reading.squareMeters).toBeGreaterThan(0);
  });
});

describe('closeRing / measureCollection', () => {
  it('appends the first vertex when the ring is open', () => {
    const ring = closeRing([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(ring).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
  });

  it('builds line + vertices for distance sketches', () => {
    const collection = measureCollection('distance', [
      [68.78, 38.56],
      [68.79, 38.56],
    ]);
    expect(collection.features).toHaveLength(3);
    expect(collection.features.some((f) => f.geometry.type === 'LineString')).toBe(true);
  });
});

describe('formatters', () => {
  it('picks meters then kilometres', () => {
    expect(formatDistanceMeters(850).unit).toBe('m');
    expect(formatDistanceMeters(1500).unit).toBe('km');
  });

  it('picks m² then ha then km²', () => {
    expect(formatAreaSquareMeters(500).unit).toBe('m2');
    expect(formatAreaSquareMeters(25_000).unit).toBe('ha');
    expect(formatAreaSquareMeters(2_500_000).unit).toBe('km2');
  });
});
