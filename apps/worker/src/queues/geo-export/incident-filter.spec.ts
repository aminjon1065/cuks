import { describe, expect, it } from 'vitest';
import type { IncidentRegistryFilters } from '@cuks/shared';
import { incidentExportConditions } from './incident-filter';

/** Render a drizzle SQL chunk to inspectable text + params. */
function render(condition: { queryChunks?: unknown[] }): string {
  return JSON.stringify(condition);
}

describe('incidentExportConditions', () => {
  it('always excludes soft-deleted incidents', () => {
    const [first] = incidentExportConditions({});
    expect(render(first!)).toContain('deleted_at IS NULL');
  });

  it('matches severity exactly, like the registry — not as a threshold', () => {
    // The registry (IncidentsService.whereFor) uses eq(severity), so exporting a
    // "severity = 3" selection must not leak 4 and 5.
    const conditions = incidentExportConditions({ severity: 3 } as IncidentRegistryFilters);
    const rendered = conditions.map(render).join(' ');
    expect(rendered).toContain('i.severity =');
    expect(rendered).not.toContain('>=');
    // The bound parameter is the exact level.
    expect(rendered).toContain('3');
  });

  it('searches by substring ILIKE over number/description/address (registry parity)', () => {
    const conditions = incidentExportConditions({ search: 'мост' } as IncidentRegistryFilters);
    const rendered = conditions.map(render).join(' ');
    expect(rendered).toContain('i.number ILIKE');
    expect(rendered).toContain('i.description ILIKE');
    expect(rendered).toContain('i.address_text ILIKE');
    expect(rendered).not.toContain('tsquery');
    expect(rendered).toContain('%мост%');
  });

  it('builds only the conditions the filters ask for', () => {
    expect(incidentExportConditions({})).toHaveLength(1); // just the deleted_at guard
    expect(
      incidentExportConditions({
        status: 'active',
        regionId: '019f0000-0000-7000-8000-000000000001',
      } as IncidentRegistryFilters),
    ).toHaveLength(3);
  });
});
