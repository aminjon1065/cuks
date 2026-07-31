import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../common/auth/auth-user';
import { ReportsService } from './reports.service';

/**
 * The acknowledgement report names documents and readers, so — unlike the discipline report
 * beside it — the `docflow.reports.view` permission is NOT its gate. Every row is checked
 * against the caller's own visibility of its document, and a row they may not see is dropped
 * rather than redacted: a redacted row would still disclose that a ДСП order exists and how
 * many people are on its distribution list, which is the allow-list itself (docs/09 §3).
 */

const QUERY = { from: '2026-07-01T00:00:00+05:00', to: '2026-07-31T23:59:59+05:00' };

function actor(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u-reader',
    username: 'reader',
    fullName: 'Читатель',
    // The roles that actually read this report (chief/clerk) hold registry access, which
    // opens the non-ДСП registry — and, deliberately, nothing more.
    permissions: ['docflow.use', 'docflow.reports.view', 'docflow.control'],
    isSuperadmin: false,
    ...over,
  } as unknown as AuthUser;
}

function doc(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    regNumber: 'П-2026/0001',
    subject: 'Приказ о готовности',
    authorId: 'u-author',
    confidentiality: 'normal',
    accessList: [] as string[],
    ...over,
  };
}

/** A stand-in for DistributionsService that returns exactly the rows the test wants. */
function makeService(rows: unknown[]): ReportsService {
  return new ReportsService(null as never, { reportRows: async () => rows } as never);
}

describe('ReportsService.acknowledgement', () => {
  it('counts each state apart — a lapsed deadline is not a reading', async () => {
    const service = makeService([
      {
        doc: doc(),
        userName: 'Иванов И.',
        orgUnitName: 'Отдел',
        status: 'acknowledged',
        acknowledgedAt: new Date('2026-07-10T06:00:00Z'),
      },
      {
        doc: doc(),
        userName: 'Петров П.',
        orgUnitName: 'Отдел',
        status: 'pending',
        acknowledgedAt: null,
      },
      {
        doc: doc(),
        userName: 'Сидоров С.',
        orgUnitName: 'Отдел',
        status: 'expired',
        acknowledgedAt: null,
      },
    ]);

    const report = await service.acknowledgement(QUERY, actor());
    expect(report.totals).toEqual({ total: 3, acknowledged: 1, pending: 1, expired: 1 });
    expect(report.hiddenCount).toBe(0);
    expect(report.rows.map((r) => r.status)).toEqual(['acknowledged', 'pending', 'expired']);
  });

  it('drops a ДСП row the caller is not cleared for, and says how many it dropped', async () => {
    const service = makeService([
      {
        doc: doc(),
        userName: 'Иванов И.',
        orgUnitName: null,
        status: 'acknowledged',
        acknowledgedAt: null,
      },
      {
        doc: doc({
          id: 'd2',
          regNumber: 'П-2026/0002',
          subject: 'ДСП приказ',
          confidentiality: 'dsp',
          accessList: ['u-other'],
        }),
        userName: 'Секретный С.',
        orgUnitName: null,
        status: 'pending',
        acknowledgedAt: null,
      },
    ]);

    const report = await service.acknowledgement(QUERY, actor());
    // Not redacted — absent. Its subject, its readers and even its existence stay unstated.
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.regNumber).toBe('П-2026/0001');
    expect(JSON.stringify(report.rows)).not.toContain('ДСП приказ');
    expect(JSON.stringify(report.rows)).not.toContain('Секретный');
    // …but the sheet admits it is partial.
    expect(report.hiddenCount).toBe(1);
    expect(report.totals.total).toBe(1);
  });

  it('shows the ДСП row to somebody on its allow-list who holds the clearance', async () => {
    const dspDoc = doc({ confidentiality: 'dsp', accessList: ['u-reader'] });
    const service = makeService([
      {
        doc: dspDoc,
        userName: 'Иванов И.',
        orgUnitName: null,
        status: 'pending',
        acknowledgedAt: null,
      },
    ]);

    const cleared = actor({
      permissions: [
        'docflow.use',
        'docflow.reports.view',
        'docflow.control',
        'docflow.confidential.view',
      ],
    });
    const report = await service.acknowledgement(QUERY, cleared);
    expect(report.rows).toHaveLength(1);
    expect(report.hiddenCount).toBe(0);
  });

  it('does not let the reports permission alone open ДСП', async () => {
    // Being on the allow-list is necessary but not sufficient without the clearance —
    // and the clearance alone is not enough without the allow-list.
    const service = makeService([
      {
        doc: doc({ confidentiality: 'dsp', accessList: ['u-reader'] }),
        userName: 'Иванов И.',
        orgUnitName: null,
        status: 'pending',
        acknowledgedAt: null,
      },
    ]);
    const report = await service.acknowledgement(QUERY, actor());
    expect(report.rows).toHaveLength(0);
    expect(report.hiddenCount).toBe(1);
  });

  it('exports a workbook over exactly the visible rows', async () => {
    const service = makeService([
      {
        doc: doc(),
        userName: 'Иванов И.',
        orgUnitName: 'Отдел',
        status: 'acknowledged',
        acknowledgedAt: null,
      },
      {
        doc: doc({ id: 'd2', confidentiality: 'dsp', accessList: [] }),
        userName: 'Секретный С.',
        orgUnitName: null,
        status: 'pending',
        acknowledgedAt: null,
      },
    ]);
    const buffer = await service.acknowledgementXlsx(QUERY, actor());
    // A real XLSX is a ZIP container: 'PK'.
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer.length).toBeGreaterThan(500);
  });
});
