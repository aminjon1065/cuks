import { config as loadEnv } from 'dotenv';

// Runs from packages/db; load the monorepo-root .env for DATABASE_URL.
loadEnv({ path: ['.env', '../../.env'] });

import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { ARGON2_OPTIONS, type IncidentStatus } from '@cuks/shared';
import { createDb, type Database } from './client';
import {
  adminUnits,
  incidents,
  notificationOutbox,
  notifications,
  roles,
  userRoles,
  users,
} from './schema/index';
import { mapIncidentTimes } from './seed-e2e-fixtures';

/**
 * Provisions the dedicated Playwright e2e admin (docs/plan 0.14). It gets the
 * `superadmin` role — the real role-assigner in the system: a non-superadmin can
 * only grant roles whose permissions are a subset of its own (privilege-bounded
 * delegation, docs/05 §3), so the "assign role" smoke needs a superadmin to grant an
 * operational role. Its 2FA is reset to a clean pre-enrollment state on every run so
 * `global-setup.ts` can always enroll TOTP fresh and the suite stays deterministic
 * and re-runnable. Requires the base seed (`pnpm db:seed`) to have created the role
 * templates first. The seed `admin` is also a superadmin, so the last-superadmin
 * guard (revoke-only) is never at risk here.
 *
 * Credentials are kept in sync with apps/web/e2e/support/fixtures.ts.
 */
const E2E_USERNAME = 'e2e_admin';
// Fixed test password — must match apps/web/e2e/support/fixtures.ts.
const E2E_PASSWORD = 'E2eAdmin!Passw0rd';
const E2E_ROLE_CODE = 'superadmin';

// Plain non-superadmin (files.use) for the phase-1 permission e2e (task 1.9):
// viewer-can't-upload, non-member-403. `employee` carries none of the
// admin.*/docflow.sign/gis.pg.access perms, so no 2FA gate — password-only login.
const E2E_USER_USERNAME = 'e2e_user';
const E2E_USER_PASSWORD = 'E2eUser!Passw0rd';
const E2E_USER_ROLE_CODE = 'employee';
// A second plain user so the permission spec can test owner → viewer/non-member
// without any superadmin (whose access bypass would defeat the 403 checks).
const E2E_USER2_USERNAME = 'e2e_user2';
const E2E_USER2_PASSWORD = 'E2eUser2!Passw0rd';
const E2E_DUTY_USERNAME = 'e2e_duty';
const E2E_DUTY_PASSWORD = 'E2eDuty!Passw0rd';

async function provisionUser(
  db: Database,
  opts: {
    username: string;
    password: string;
    roleCode: string;
    fullName: string;
    shortName: string;
    email?: string;
  },
): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.code, opts.roleCode));
  if (!role) throw new Error(`Role "${opts.roleCode}" is missing — run \`pnpm db:seed\` first`);

  const passwordHash = await argon2.hash(opts.password, {
    type: argon2.argon2id,
    ...ARGON2_OPTIONS,
  });

  // Clean baseline: active, no forced password change, 2FA disabled and secret
  // cleared — global-setup re-enrolls the admin's TOTP through the UI every run;
  // the plain user needs no 2FA (its role isn't gated).
  const baseline = {
    passwordHash,
    fullName: opts.fullName,
    shortName: opts.shortName,
    status: 'active' as const,
    mustChangePassword: false,
    totpSecret: null,
    totpEnabled: false,
    deletedAt: null,
    email: opts.email ?? null,
  };

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, opts.username));

  let userId: string;
  if (existing) {
    await db.update(users).set(baseline).where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({ username: opts.username, ...baseline })
      .returning({ id: users.id });
    if (!created) throw new Error(`Failed to create the e2e user "${opts.username}"`);
    userId = created.id;
  }

  // Reset role assignments to exactly the intended one (deterministic across reruns).
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.insert(userRoles).values({ userId, roleId: role.id, orgUnitId: null });
  await db.delete(notifications).where(eq(notifications.userId, userId));
  return userId;
}

/** Stable incident fixtures for the committed map smoke. They intentionally sit
 * close together around Dushanbe so z6 emits a cluster and z11 emits individual
 * severity/status markers. */
async function provisionMapIncidents(db: Database, actorId: string): Promise<void> {
  const [region] = await db
    .select({ id: adminUnits.id })
    .from(adminUnits)
    .where(eq(adminUnits.code, 'TJ-DU'));
  if (!region) throw new Error('E2E map fixtures require the seeded TJ-DU region');

  const now = Date.now();
  const fixtureStatuses: IncidentStatus[] = [
    'active',
    'reported',
    'localized',
    'eliminated',
    'closed',
  ];
  for (let i = 0; i < 12; i++) {
    const number = `ЧС-E2E-${String(i + 1).padStart(3, '0')}`;
    const { occurredAt, reportedAt } = mapIncidentTimes(now, i);
    const status = fixtureStatuses[i % fixtureStatuses.length]!;
    const severity = i < fixtureStatuses.length ? 3 : (i % 5) + 1;
    const closedAt = status === 'closed' ? reportedAt : null;
    // E2E-001 is exactly on a z11/z12 vertical tile seam. The MVT function
    // must publish it from one adjacent tile only (0015 regression fixture).
    const lon = i === 0 ? 68.73046875 : 68.787 + ((i % 4) - 1.5) * 0.004;
    const lat = 38.559 + ((Math.floor(i / 4) % 3) - 1) * 0.004;
    await db
      .insert(incidents)
      .values({
        number,
        typeCode: i % 2 === 0 ? 'nat.hydro.flood' : 'tech.fire_explosion',
        severity,
        status,
        occurredAt,
        reportedAt,
        regionId: region.id,
        geom: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
        source: 'monitoring',
        createdBy: actorId,
        closedAt,
        closedBy: status === 'closed' ? actorId : null,
      })
      .onConflictDoUpdate({
        target: incidents.number,
        set: {
          severity,
          status,
          occurredAt,
          reportedAt,
          regionId: region.id,
          geom: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
          closedAt,
          closedBy: status === 'closed' ? actorId : null,
          updatedAt: new Date(),
          deletedAt: null,
        },
      });
  }

  const invalidChronology = await db.execute<{ invalid_count: number }>(sql`
    select count(*)::integer as invalid_count
    from app.incidents
    where number like 'ЧС-E2E-%'
      and occurred_at > reported_at
  `);
  if (Number(invalidChronology.rows[0]?.invalid_count ?? 0) > 0) {
    throw new Error('E2E map fixtures violate occurred_at <= reported_at');
  }
}

async function provision(db: Database): Promise<void> {
  // The API can be running while this deterministic seed is applied. Remove
  // stale incident handoff markers before clearing the e2e users' feeds so a
  // prior failed run cannot be delivered later into the next test's assertions.
  await db.delete(notificationOutbox).where(eq(notificationOutbox.topic, 'incidents.notification'));

  const adminId = await provisionUser(db, {
    username: E2E_USERNAME,
    password: E2E_PASSWORD,
    roleCode: E2E_ROLE_CODE,
    fullName: 'E2E Администратор',
    shortName: 'E2E Админ',
  });
  await provisionUser(db, {
    username: E2E_USER_USERNAME,
    password: E2E_USER_PASSWORD,
    roleCode: E2E_USER_ROLE_CODE,
    fullName: 'E2E Пользователь',
    shortName: 'E2E Юзер',
  });
  await provisionUser(db, {
    username: E2E_USER2_USERNAME,
    password: E2E_USER2_PASSWORD,
    roleCode: E2E_USER_ROLE_CODE,
    fullName: 'E2E Пользователь 2',
    shortName: 'E2E Юзер 2',
  });
  await provisionUser(db, {
    username: E2E_DUTY_USERNAME,
    password: E2E_DUTY_PASSWORD,
    roleCode: 'duty_officer',
    fullName: 'E2E Оперативный дежурный',
    shortName: 'E2E Дежурный',
    email: 'e2e-duty@cuks.local',
  });
  await provisionMapIncidents(db, adminId);
  console.log(
    `e2e users ready: "${E2E_USERNAME}" (${E2E_ROLE_CODE}, 2FA reset for enrollment) + ` +
      `"${E2E_USER_USERNAME}"/"${E2E_USER2_USERNAME}" (${E2E_USER_ROLE_CODE}); ` +
      `"${E2E_DUTY_USERNAME}" (duty_officer); 12 clustered map incidents.`,
  );
}

async function main(): Promise<void> {
  // Never provision a known-password superadmin against a production database.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-e2e must not run with NODE_ENV=production (test fixture only)');
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for the e2e seed');

  const { db, pool } = createDb(url);
  try {
    await provision(db);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
