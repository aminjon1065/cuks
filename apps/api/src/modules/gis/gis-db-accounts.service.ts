import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { gisDbAccounts, type Database, type PgPool } from '@cuks/db';
import {
  slugify,
  type CreateGisDbAccountInput,
  type GisDbAccountDto,
  type GisDbAccountSecretDto,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB, PG_POOL } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';

type GisDbAccount = typeof gisDbAccounts.$inferSelect;

/** A bound pg query on a checked-out client. */
type Query = (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

/** Every managed role name is `cuks_gis_<label>` — a fixed prefix keeps them
 *  recognisable in `pg_roles` and impossible to confuse with a platform role. */
const ROLE_PREFIX = 'cuks_gis_';
/** Postgres identifier limit is 63 bytes; keep room for the prefix. */
const MAX_LABEL = 40;

/**
 * Direct PostGIS access accounts for QGIS/ArcGIS (docs/modules/10 §7, docs/09
 * §Права PG; task 2.9). An admin issues a login role scoped to the `gis` schema —
 * `reader` gets SELECT, `editor` also gets write (for WFS-T). The role lives in
 * `pg_roles`; this table is only the audit-friendly registry of what was issued.
 * The password is generated, shown once, and never stored (reset = drop + recreate).
 *
 * Role management is the one thing drizzle cannot express, so it runs through the
 * raw pool. DDL takes no bind parameters, so the name and password are interpolated
 * — but both are server-controlled (a validated `cuks_gis_<slug>` name, an
 * alphanumeric password) and each is still defensively quoted (see `createRole`).
 */
@Injectable()
export class GisDbAccountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly pool: PgPool,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<GisDbAccountDto[]> {
    const rows = await this.db.select().from(gisDbAccounts).orderBy(desc(gisDbAccounts.createdAt));
    return rows.map((row) => this.toDto(row));
  }

  async create(input: CreateGisDbAccountInput, user: AuthUser): Promise<GisDbAccountSecretDto> {
    const label = slugify(input.label).replace(/-/g, '_').slice(0, MAX_LABEL) || 'account';
    const username = `${ROLE_PREFIX}${label}`;
    const password = generatePassword();

    // Registry row first: its unique index rejects a duplicate name before we
    // create a role that would then be orphaned.
    let record: GisDbAccount;
    try {
      const [created] = await this.db
        .insert(gisDbAccounts)
        .values({
          username,
          kind: input.kind,
          ...(input.note ? { note: input.note } : {}),
          createdBy: user.id,
        })
        .returning();
      record = created!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict('gis.db_account.exists', 'An account with that name exists', {
          username,
        });
      }
      throw error;
    }

    try {
      await this.createRole(username, password, input.kind);
    } catch (error) {
      // createRole is atomic (its DDL runs in one transaction), so a failure leaves no
      // role behind; still drop defensively before removing the registry row, so the
      // two sides always stay in step and a retry with the same name is never blocked.
      await this.dropRole(username).catch(() => undefined);
      await this.db.delete(gisDbAccounts).where(eq(gisDbAccounts.id, record.id));
      throw error;
    }

    this.audit.log({
      action: 'gis.db_account.created',
      actorId: user.id,
      entityType: 'gis_db_account',
      entityId: record.id,
      meta: { username, kind: input.kind },
    });
    return { ...this.toDto(record), password };
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const [record] = await this.db
      .select()
      .from(gisDbAccounts)
      .where(eq(gisDbAccounts.id, id))
      .limit(1);
    if (!record) throw AppException.notFound('gis.db_account.not_found', 'Account not found');

    await this.dropRole(record.username);
    await this.db.delete(gisDbAccounts).where(eq(gisDbAccounts.id, id));
    this.audit.log({
      action: 'gis.db_account.deleted',
      actorId: user.id,
      entityType: 'gis_db_account',
      entityId: id,
      meta: { username: record.username, kind: record.kind },
    });
  }

  // --- role management (raw pool; identifiers/literals quoted server-side) ---

  /**
   * Create the login role and grant it exactly the `gis` schema — nothing in
   * `app`, `public`, or the DB at large. `ALTER DEFAULT PRIVILEGES` covers tables
   * created later (an imported layer's `gis.l_<slug>`) so the account keeps working
   * without a re-grant. `NOINHERIT`/no other role memberships keep the scope tight.
   */
  private async createRole(username: string, password: string, kind: string): Promise<void> {
    // DDL cannot use bind parameters (`CREATE ROLE $1` is a syntax error, and a DO
    // block takes none), so the two inputs are interpolated — but both are
    // server-controlled: the name is `cuks_gis_<slug>` (ASCII, validated) and the
    // password is drawn from an alphanumeric alphabet (no quote/backslash). Each is
    // still quoted defensively: the name double-quoted, the literal single-quoted
    // with any quote doubled.
    const role = quoteIdent(username);
    const dataGrant = kind === 'editor' ? 'SELECT, INSERT, UPDATE, DELETE' : 'SELECT';
    const seqGrant = kind === 'editor' ? 'USAGE, SELECT, UPDATE' : 'SELECT';

    // CREATE ROLE and GRANT are transactional in PostgreSQL, so the whole grant set is
    // applied all-or-nothing. This matters in production, where the app role may hold
    // CREATEROLE but not own a `gis` table it tries to GRANT: without the transaction a
    // mid-sequence failure would commit CREATE ROLE and orphan a login the app can no
    // longer see (its registry row is rolled back) or drop.
    await this.withClient(async (query) => {
      await query('BEGIN');
      try {
        const database = quoteIdent(await this.currentDatabase(query));
        await query(
          `CREATE ROLE ${role} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
        );
        await query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
        // Deny the default `public` schema so the account is confined to `gis` alone
        // (a fresh role otherwise inherits PUBLIC's USAGE on `public`) — docs/09 §Права PG.
        await query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
        await query(`GRANT USAGE ON SCHEMA gis TO ${role}`);
        await query(`GRANT ${dataGrant} ON ALL TABLES IN SCHEMA gis TO ${role}`);
        await query(`GRANT ${seqGrant} ON ALL SEQUENCES IN SCHEMA gis TO ${role}`);
        // Future tables (imported layers) inherit the same grants.
        await query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA gis GRANT ${dataGrant} ON TABLES TO ${role}`,
        );
        await query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA gis GRANT ${seqGrant} ON SEQUENCES TO ${role}`,
        );
        await query('COMMIT');
      } catch (error) {
        await query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  private async dropRole(username: string): Promise<void> {
    const role = quoteIdent(username);
    await this.withClient(async (query) => {
      // A role owning nothing still holds grants; DROP OWNED first so DROP ROLE
      // never fails on "role has privileges". Guarded so a missing role is a no-op.
      const exists = await query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);
      if (exists.rows.length === 0) return;
      await query(`DROP OWNED BY ${role}`);
      await query(`DROP ROLE ${role}`);
    });
  }

  private async currentDatabase(query: Query): Promise<string> {
    const result = await query('SELECT current_database()');
    return (result.rows[0] as { current_database: string }).current_database;
  }

  private async withClient(fn: (query: Query) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await fn((text, params) => client.query(text, params));
    } finally {
      client.release();
    }
  }

  private toDto(row: GisDbAccount): GisDbAccountDto {
    return {
      id: row.id,
      username: row.username,
      kind: row.kind,
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** A strong, copy-pasteable password (no ambiguous chars, no shell metacharacters
 *  since it may be pasted into a connection string). */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(24);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function quoteIdent(name: string): string {
  // Any identifier interpolated into DDL is double-quoted with internal quotes
  // doubled (the name is already `cuks_gis_<slug>`, but defence in depth).
  return `"${name.replace(/"/g, '""')}"`;
}

/** A single-quoted SQL string literal, with any quote doubled. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
