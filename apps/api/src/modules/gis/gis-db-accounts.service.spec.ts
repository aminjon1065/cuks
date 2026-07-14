import { describe, expect, it, vi } from 'vitest';
import { GisDbAccountsService } from './gis-db-accounts.service';
import type { AuthUser } from '../../common/auth/auth-user';

const USER = { id: 'u1', username: 'admin', isSuperadmin: true } as unknown as AuthUser;

/** A db double: insert returns the row, delete records its calls. */
function fakeDb(insertRows: unknown[], selectRows: unknown[] = insertRows) {
  const del = { where: vi.fn(async () => undefined) };
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) chain[method] = () => chain;
  chain['limit'] = async () => selectRows;
  return {
    db: {
      insert: () => ({ values: () => ({ returning: async () => insertRows }) }),
      select: () => chain,
      delete: () => del,
    },
    del,
  };
}

/** A pool double capturing the SQL its client runs. */
function fakePool(
  overrides: { failCreate?: boolean; failGrant?: boolean; roleExists?: boolean } = {},
) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      if (overrides.failCreate && text.startsWith('CREATE ROLE')) {
        throw new Error('permission denied to create role');
      }
      // Simulate the production case: CREATE ROLE succeeds but a later grant fails
      // (the app role holds CREATEROLE yet does not own the gis table it grants).
      if (overrides.failGrant && text.startsWith('GRANT')) {
        throw new Error('permission denied for table');
      }
      if (text.includes('current_database')) return { rows: [{ current_database: 'cuks' }] };
      if (text.includes('pg_roles')) return { rows: overrides.roleExists === false ? [] : [{}] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client }, client, statements };
}

const audit = { log: vi.fn() } as never;

describe('GisDbAccountsService.create', () => {
  it('names the role cuks_gis_<transliterated label> and returns the password once', async () => {
    const record = {
      id: 'a1',
      username: 'cuks_gis_ivanov',
      kind: 'reader',
      note: null,
      createdBy: 'u1',
      createdAt: new Date('2026-07-15T00:00:00Z'),
    };
    const { db } = fakeDb([record]);
    const { pool, statements } = fakePool();
    const service = new GisDbAccountsService(db as never, pool as never, audit);

    const result = await service.create({ label: 'Иванов', kind: 'reader' }, USER);
    expect(result.username).toBe('cuks_gis_ivanov');
    expect(result.password).toHaveLength(24);
    // The DTO the list returns must never carry the password.
    expect(statements.some((s) => s.startsWith('CREATE ROLE "cuks_gis_ivanov"'))).toBe(true);
  });

  it('grants a reader SELECT only, an editor full DML — and neither superuser', async () => {
    for (const [kind, expectWrite] of [
      ['reader', false],
      ['editor', true],
    ] as const) {
      const { db } = fakeDb([
        {
          id: 'a',
          username: 'cuks_gis_x',
          kind,
          note: null,
          createdBy: 'u1',
          createdAt: new Date('2026-07-15T00:00:00Z'),
        },
      ]);
      const { pool, statements } = fakePool();
      const service = new GisDbAccountsService(db as never, pool as never, audit);
      await service.create({ label: 'x', kind }, USER);

      const grants = statements.filter((s) => s.startsWith('GRANT') && s.includes('ON ALL TABLES'));
      expect(grants[0]).toContain('SELECT');
      expect(grants[0]?.includes('INSERT')).toBe(expectWrite);
      // Every managed role is created without superuser/createdb/createrole.
      const create = statements.find((s) => s.startsWith('CREATE ROLE'));
      expect(create).toContain('NOSUPERUSER');
      expect(create).toContain('NOCREATEROLE');
      // Only the gis schema is ever granted.
      expect(statements.some((s) => s.includes('SCHEMA app'))).toBe(false);
    }
  });

  it('rolls back the registry row when the role cannot be created', async () => {
    const { db, del } = fakeDb([
      {
        id: 'a1',
        username: 'cuks_gis_x',
        kind: 'reader',
        note: null,
        createdBy: 'u1',
        createdAt: new Date('2026-07-15T00:00:00Z'),
      },
    ]);
    const { pool } = fakePool({ failCreate: true });
    const service = new GisDbAccountsService(db as never, pool as never, audit);
    await expect(service.create({ label: 'x', kind: 'reader' }, USER)).rejects.toThrow();
    expect(del.where).toHaveBeenCalled();
  });

  it('wraps role creation in a transaction so a mid-grant failure leaves no orphan', async () => {
    const { db, del } = fakeDb([
      {
        id: 'a1',
        username: 'cuks_gis_x',
        kind: 'reader',
        note: null,
        createdBy: 'u1',
        createdAt: new Date('2026-07-15T00:00:00Z'),
      },
    ]);
    const { pool, statements } = fakePool({ failGrant: true });
    const service = new GisDbAccountsService(db as never, pool as never, audit);
    await expect(service.create({ label: 'x', kind: 'reader' }, USER)).rejects.toThrow();
    // CREATE ROLE ran, a GRANT failed — the transaction must roll the CREATE ROLE back
    // (no orphan) and the registry row must be removed so the two sides stay in step.
    expect(statements).toContain('BEGIN');
    expect(statements.some((s) => s.startsWith('CREATE ROLE'))).toBe(true);
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(del.where).toHaveBeenCalled();
  });
});

describe('GisDbAccountsService.remove', () => {
  it('drops the owned objects then the role, and deletes the registry row', async () => {
    const { db, del } = fakeDb([], [{ id: 'a1', username: 'cuks_gis_x', kind: 'reader' }]);
    const { pool, statements } = fakePool({ roleExists: true });
    const service = new GisDbAccountsService(db as never, pool as never, audit);
    await service.remove('a1', USER);
    expect(statements.some((s) => s.startsWith('DROP OWNED BY "cuks_gis_x"'))).toBe(true);
    expect(statements.some((s) => s.startsWith('DROP ROLE "cuks_gis_x"'))).toBe(true);
    expect(del.where).toHaveBeenCalled();
  });

  it('404s for an unknown account', async () => {
    const { db } = fakeDb([], []);
    const { pool } = fakePool();
    const service = new GisDbAccountsService(db as never, pool as never, audit);
    await expect(service.remove('missing', USER)).rejects.toMatchObject({
      code: 'gis.db_account.not_found',
    });
  });
});
