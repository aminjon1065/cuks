import { describe, expect, it } from 'vitest';
import { GisPlacesService } from './gis-places.service';

describe('GisPlacesService.search', () => {
  it('returns admin units and facilities ranked by level', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => {
                // First call = admin units, second = facilities (Promise.all order).
                if (!db._n) db._n = 0;
                db._n += 1;
                if (db._n === 1) {
                  return [
                    {
                      id: 'd1',
                      level: 'district' as const,
                      nameRu: 'Бохтар',
                      nameTg: 'Бохтар',
                      code: 'TJ-KT-B',
                      west: 68.5,
                      south: 37.7,
                      east: 69.0,
                      north: 38.1,
                      lon: 68.8,
                      lat: 37.9,
                    },
                  ];
                }
                return [
                  {
                    id: 'f1',
                    name: 'Больница Бохтар',
                    kind: 'hospital',
                    lon: 68.78,
                    lat: 37.84,
                  },
                ];
              },
            }),
          }),
        }),
      }),
      _n: 0,
    };

    const service = new GisPlacesService(db as never);
    const result = await service.search({ q: 'Бохтар', limit: 10 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      kind: 'admin_unit',
      level: 'district',
      label: 'Бохтар',
    });
    expect(result.items[1]?.kind).toBe('facility');
    expect(result.items[0]?.bounds[0]).toBeLessThan(result.items[0]!.bounds[2]);
  });
});
