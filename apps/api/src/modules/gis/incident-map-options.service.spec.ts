import { describe, expect, it, vi } from 'vitest';
import { IncidentMapOptionsService } from './incident-map-options.service';

function selectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where']) chain[method] = () => chain;
  chain['orderBy'] = () => Promise.resolve(result);
  return chain;
}

describe('IncidentMapOptionsService', () => {
  it('returns active leaf types with parent labels and sorted regions', async () => {
    const typeRows = [
      {
        code: 'natural',
        parentCode: null,
        nameRu: 'Природная ЧС',
        nameTg: 'Природная ЧС',
      },
      {
        code: 'nat.hydro',
        parentCode: 'natural',
        nameRu: 'Гидрологические',
        nameTg: 'Гидрологические',
      },
      {
        code: 'nat.hydro.flood',
        parentCode: 'nat.hydro',
        nameRu: 'Наводнение',
        nameTg: 'Наводнение',
      },
    ];
    const regions = [{ id: 'r1', code: 'TJ-DU', nameRu: 'Душанбе', nameTg: 'Душанбе' }];
    const select = vi
      .fn()
      .mockReturnValueOnce(selectChain(typeRows))
      .mockReturnValueOnce(selectChain(regions));
    const service = new IncidentMapOptionsService({ select } as never);

    const result = await service.getOptions();

    expect(result.regions).toEqual(regions);
    expect(result.types).toEqual([
      {
        ...typeRows[2],
        parentNameRu: 'Гидрологические',
        parentNameTg: 'Гидрологические',
      },
    ]);
  });
});
