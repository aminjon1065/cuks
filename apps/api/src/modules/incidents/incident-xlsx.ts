import { buildXlsx, type XlsxRow } from '@cuks/shared/office/xlsx';

/**
 * Registry export (docs/modules/10 §5). The workbook writer itself lives in
 * `@cuks/shared/office/xlsx` — the geo-export worker (2.8) writes the same format
 * for its XLSX exports, and one implementation cannot drift from itself.
 */
export type IncidentExportRow = XlsxRow;

export function buildIncidentXlsx(rows: readonly IncidentExportRow[]): Buffer {
  return Buffer.from(buildXlsx(rows, 'Реестр ЧС'));
}
