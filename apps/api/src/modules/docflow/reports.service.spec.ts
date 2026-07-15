import { describe, expect, it } from 'vitest';
import { orgUnits } from '@cuks/db';
import { ReportsService } from './reports.service';
import type { AuthUser } from '../../common/auth/auth-user';

/**
 * A chainable Drizzle stub. `select().from(t)…` resolves at the terminal (`groupBy`/`limit`) to
 * a result chosen by the `from` table: the aggregate rows for the resolutions scan, the org-unit
 * path rows for the subtree lookup.
 */
function makeDb(aggregates: unknown[], pathRows: { path: string }[] = []) {
  return {
    select() {
      let result: unknown[] = [];
      const chain: Record<string, unknown> = {
        from(table: unknown) {
          result = table === orgUnits ? pathRows : aggregates;
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        groupBy: () => Promise.resolve(result),
        limit: () => Promise.resolve(result),
      };
      return chain;
    },
  };
}

const ACTOR = { id: 'u1', permissions: ['docflow.reports.view'], isSuperadmin: false } as AuthUser;
const QUERY = { from: '2026-06-01T00:00:00+05:00', to: '2026-06-30T23:59:59+05:00' };

const agg = (over: Partial<Record<string, unknown>>) => ({
  executorId: 'e1',
  executorName: 'И. Иванов',
  orgUnitId: 'ou1',
  orgUnitName: 'Управление А',
  onTime: 0,
  late: 0,
  notDone: 0,
  ...over,
});

describe('ReportsService.discipline', () => {
  it('derives the discipline percentage from the buckets', async () => {
    const service = new ReportsService(makeDb([agg({ onTime: 3, late: 1, notDone: 1 })]) as never);
    const report = await service.discipline(QUERY, ACTOR);
    const row = report.groups[0]!.rows[0]!;
    expect(row.total).toBe(5);
    expect(row.disciplinePct).toBe(60); // round(3/5 * 100)
    expect(report.totals.total).toBe(5);
    expect(report.totals.disciplinePct).toBe(60);
  });

  it('groups executors by subdivision with a subtotal and a grand total', async () => {
    const service = new ReportsService(
      makeDb([
        agg({ executorId: 'e1', executorName: 'Б. Первый', onTime: 2 }),
        agg({ executorId: 'e2', executorName: 'А. Второй', late: 1, notDone: 1 }),
        agg({
          executorId: 'e3',
          executorName: 'В. Третий',
          orgUnitId: 'ou2',
          orgUnitName: 'Отдел Б',
          onTime: 1,
        }),
      ]) as never,
    );
    const report = await service.discipline(QUERY, ACTOR);

    expect(report.groups).toHaveLength(2);
    const unitA = report.groups.find((g) => g.orgUnitId === 'ou1')!;
    // Executors sort by name within the group (А. before Б.).
    expect(unitA.rows.map((r) => r.executorName)).toEqual(['А. Второй', 'Б. Первый']);
    expect(unitA.total).toBe(4); // 2 onTime + 1 late + 1 notDone
    expect(unitA.onTime).toBe(2);
    expect(unitA.disciplinePct).toBe(50);

    expect(report.totals.total).toBe(5);
    expect(report.totals.onTime).toBe(3);
    expect(report.totals.disciplinePct).toBe(60);
  });

  it('puts executors without a primary position in «Без подразделения», sorted last', async () => {
    const service = new ReportsService(
      makeDb([
        agg({ executorId: 'e1', orgUnitId: null, orgUnitName: null, onTime: 1 }),
        agg({ executorId: 'e2', orgUnitId: 'ou1', orgUnitName: 'Управление А', onTime: 1 }),
      ]) as never,
    );
    const report = await service.discipline(QUERY, ACTOR);
    expect(report.groups.map((g) => g.orgUnitName)).toEqual(['Управление А', 'Без подразделения']);
    expect(report.groups[1]!.orgUnitId).toBeNull();
  });

  it('reports an empty period as zeros with a null percentage', async () => {
    const service = new ReportsService(makeDb([]) as never);
    const report = await service.discipline(QUERY, ACTOR);
    expect(report.groups).toHaveLength(0);
    expect(report.totals).toMatchObject({
      total: 0,
      onTime: 0,
      late: 0,
      notDone: 0,
      disciplinePct: null,
    });
  });

  it('exports a valid XLSX workbook (ZIP magic bytes)', async () => {
    const service = new ReportsService(makeDb([agg({ onTime: 2, late: 1, notDone: 0 })]) as never);
    const buffer = await service.disciplineXlsx(QUERY, ACTOR);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });
});
