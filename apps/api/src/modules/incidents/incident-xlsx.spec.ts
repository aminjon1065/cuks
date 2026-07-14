import { describe, expect, it } from 'vitest';
import { buildIncidentXlsx } from './incident-xlsx';

describe('buildIncidentXlsx', () => {
  it('creates an XLSX ZIP with UTF-8 Cyrillic cell data', () => {
    const workbook = buildIncidentXlsx([
      ['№', 'Вид'],
      ['ЧС-2026-0001', 'Наводнение'],
    ]);

    expect(workbook.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(workbook.toString('utf8')).toContain('Наводнение');
    expect(workbook.toString('utf8')).toContain('xl/worksheets/sheet1.xml');
  });
});
