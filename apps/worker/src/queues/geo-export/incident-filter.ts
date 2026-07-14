import { sql, type SQL } from 'drizzle-orm';
import type { IncidentRegistryFilters } from '@cuks/shared';

/**
 * WHERE conditions for the incident geo-export (docs/modules/10 §6). Kept beside
 * the processor and separately testable because every operator here MUST mirror
 * `IncidentsService.whereFor` (2.5): the export of a registry selection has to
 * return the exact rows the registry list and its XLSX export show. In particular
 * severity is an *exact* level (eq), not a threshold, and the search is a substring
 * ILIKE over number/description/address — not the map tiles' full-text query.
 */
export function incidentExportConditions(filters: IncidentRegistryFilters): SQL[] {
  const conditions: SQL[] = [sql`i.deleted_at IS NULL`];
  if (filters.from) conditions.push(sql`i.occurred_at >= ${filters.from}`);
  if (filters.to) conditions.push(sql`i.occurred_at <= ${filters.to}`);
  if (filters.typeCode) conditions.push(sql`i.type_code = ${filters.typeCode}`);
  if (filters.severity) conditions.push(sql`i.severity = ${filters.severity}`);
  if (filters.status) conditions.push(sql`i.status = ${filters.status}`);
  if (filters.regionId) conditions.push(sql`i.region_id = ${filters.regionId}`);
  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(
      sql`(i.number ILIKE ${like} OR i.description ILIKE ${like} OR i.address_text ILIKE ${like})`,
    );
  }
  return conditions;
}
