import { config as loadEnv } from 'dotenv';

// Seeds run from packages/db; load the monorepo-root .env for DATABASE_URL.
loadEnv({ path: ['.env', '../../.env'] });

import argon2 from 'argon2';
import { count, eq } from 'drizzle-orm';
import { ARGON2_OPTIONS, ROLE_TEMPLATES, type OrgUnitType } from '@cuks/shared';
import { createDb, type Database } from './client';
import {
  dictionaries,
  notifications,
  orgUnits,
  positions,
  rolePermissions,
  roles,
  userPositions,
  userRoles,
  users,
} from './schema/index';

const SUPERADMIN_ROLE_CODE = 'superadmin';
const ADMIN_USERNAME = 'admin';

/** Fixed ids keep the org-skeleton seed idempotent and paths deterministic. */
interface OrgSeed {
  id: string;
  name: string;
  shortName?: string;
  type: OrgUnitType;
  parentId: string | null;
}

const ORG_SKELETON: readonly OrgSeed[] = [
  {
    id: '0190a000-0000-7000-8000-000000000001',
    name: 'КЧС',
    shortName: 'КЧС',
    type: 'committee',
    parentId: null,
  },
  {
    id: '0190a000-0000-7000-8000-000000000002',
    name: 'Центральный аппарат',
    type: 'department',
    parentId: '0190a000-0000-7000-8000-000000000001',
  },
  {
    id: '0190a000-0000-7000-8000-000000000003',
    name: 'Управление защиты населения',
    type: 'division',
    parentId: '0190a000-0000-7000-8000-000000000002',
  },
  {
    id: '0190a000-0000-7000-8000-000000000004',
    name: 'Управление гражданской обороны',
    type: 'division',
    parentId: '0190a000-0000-7000-8000-000000000002',
  },
  {
    id: '0190a000-0000-7000-8000-000000000005',
    name: 'Канцелярия',
    type: 'division',
    parentId: '0190a000-0000-7000-8000-000000000002',
  },
  {
    id: '0190a000-0000-7000-8000-000000000006',
    name: 'Управление по Согдийской области',
    type: 'department',
    parentId: '0190a000-0000-7000-8000-000000000001',
  },
  {
    id: '0190a000-0000-7000-8000-000000000007',
    name: 'Отдел по г. Худжанд',
    type: 'unit',
    parentId: '0190a000-0000-7000-8000-000000000006',
  },
  {
    id: '0190a000-0000-7000-8000-000000000008',
    name: 'Управление по Хатлонской области',
    type: 'department',
    parentId: '0190a000-0000-7000-8000-000000000001',
  },
  {
    id: '0190a000-0000-7000-8000-000000000009',
    name: 'Управление по ГБАО',
    type: 'department',
    parentId: '0190a000-0000-7000-8000-000000000001',
  },
  {
    id: '0190a000-0000-7000-8000-00000000000a',
    name: 'Управления и отделы РРП',
    type: 'department',
    parentId: '0190a000-0000-7000-8000-000000000001',
  },
];

/** name_tg is a placeholder RU string until real translations land (CLAUDE.md §4). */
interface DictSeed {
  type: 'hazard_level' | 'doc_type' | 'correspondent_category' | 'incident_type';
  code: string;
  nameRu: string;
  sort: number;
  parentCode?: string;
}

const DICTIONARIES: readonly DictSeed[] = [
  // Уровни ЧС (severity; full matrix used by GIS module 10)
  { type: 'hazard_level', code: 'local', nameRu: 'Объектового характера', sort: 1 },
  { type: 'hazard_level', code: 'municipal', nameRu: 'Местного характера', sort: 2 },
  { type: 'hazard_level', code: 'intermunicipal', nameRu: 'Муниципального характера', sort: 3 },
  { type: 'hazard_level', code: 'regional', nameRu: 'Регионального характера', sort: 4 },
  { type: 'hazard_level', code: 'national', nameRu: 'Республиканского характера', sort: 5 },
  // Типы документов
  { type: 'doc_type', code: 'incoming', nameRu: 'Входящий', sort: 1 },
  { type: 'doc_type', code: 'outgoing', nameRu: 'Исходящий', sort: 2 },
  { type: 'doc_type', code: 'internal', nameRu: 'Внутренний', sort: 3 },
  { type: 'doc_type', code: 'order', nameRu: 'Приказ', sort: 4 },
  { type: 'doc_type', code: 'directive', nameRu: 'Распоряжение', sort: 5 },
  // Категории корреспондентов
  { type: 'correspondent_category', code: 'ministry', nameRu: 'Министерство', sort: 1 },
  { type: 'correspondent_category', code: 'agency', nameRu: 'Ведомство', sort: 2 },
  { type: 'correspondent_category', code: 'local_gov', nameRu: 'Местный орган власти', sort: 3 },
  {
    type: 'correspondent_category',
    code: 'international',
    nameRu: 'Международная организация',
    sort: 4,
  },
  { type: 'correspondent_category', code: 'other', nameRu: 'Иное', sort: 5 },
  // Виды ЧС — стартовое дерево верхнего уровня (полное дерево — фаза 2.1, modules/10)
  { type: 'incident_type', code: 'natural', nameRu: 'Природная ЧС', sort: 1 },
  { type: 'incident_type', code: 'technogenic', nameRu: 'Техногенная ЧС', sort: 2 },
  { type: 'incident_type', code: 'biosocial', nameRu: 'Биолого-социальная ЧС', sort: 3 },
];

async function seedRoles(db: Database): Promise<void> {
  for (const tpl of ROLE_TEMPLATES) {
    await db
      .insert(roles)
      .values({ code: tpl.code, name: tpl.name, isSystem: tpl.system })
      .onConflictDoNothing();
    const [role] = await db.select().from(roles).where(eq(roles.code, tpl.code));
    if (!role) continue;
    for (const permission of tpl.permissions) {
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permission })
        .onConflictDoNothing();
    }
  }
}

async function seedOrg(db: Database): Promise<void> {
  const pathById = new Map<string, string>();
  for (const unit of ORG_SKELETON) {
    const path = unit.parentId ? `${pathById.get(unit.parentId) ?? ''}.${unit.id}` : unit.id;
    pathById.set(unit.id, path);
    await db
      .insert(orgUnits)
      .values({
        id: unit.id,
        parentId: unit.parentId,
        name: unit.name,
        shortName: unit.shortName ?? null,
        type: unit.type,
        path,
      })
      .onConflictDoNothing();
  }
}

async function seedAdmin(db: Database): Promise<string> {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!Now12345';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, ...ARGON2_OPTIONS });
  await db
    .insert(users)
    .values({
      username: ADMIN_USERNAME,
      passwordHash,
      fullName: 'Системный администратор',
      shortName: 'Администратор',
      mustChangePassword: true,
      status: 'active',
    })
    .onConflictDoNothing();
  const [admin] = await db.select().from(users).where(eq(users.username, ADMIN_USERNAME));
  if (!admin) throw new Error('Failed to create or find the admin user');
  return admin.id;
}

async function assignSuperadmin(db: Database, adminId: string): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.code, SUPERADMIN_ROLE_CODE));
  if (!role) throw new Error('Superadmin role missing — seedRoles must run first');
  await db
    .insert(userRoles)
    .values({ userId: adminId, roleId: role.id, orgUnitId: null })
    .onConflictDoNothing();
}

async function seedDictionaries(db: Database): Promise<void> {
  for (const d of DICTIONARIES) {
    await db
      .insert(dictionaries)
      .values({
        type: d.type,
        code: d.code,
        parentCode: d.parentCode ?? null,
        nameRu: d.nameRu,
        nameTg: d.nameRu, // placeholder until real tg translations (CLAUDE.md §4)
        sort: d.sort,
      })
      .onConflictDoNothing();
  }
}

/**
 * A few notifications for the admin so the bell/feed have content out of the box.
 * Idempotent: skipped once the admin has any. Titles are English fallbacks — the
 * client renders localized text from `type` (notifications:types.*).
 */
async function seedDemoNotifications(db: Database, adminId: string): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(eq(notifications.userId, adminId));
  if ((row?.n ?? 0) > 0) return;
  await db.insert(notifications).values([
    {
      userId: adminId,
      type: 'system.welcome',
      title: 'Welcome to CUKS',
      body: 'The platform is ready.',
    },
    {
      userId: adminId,
      type: 'docflow.route.assigned',
      title: 'Document assigned',
      body: 'A document needs your review.',
    },
    {
      userId: adminId,
      type: 'incidents.incident.created',
      title: 'Emergency registered',
      body: 'A new emergency was registered.',
      isRead: true,
      readAt: new Date(),
    },
  ]);
}

/**
 * Demo roster (Phase-0 acceptance: "two employees from the seeds see a different
 * UI by permissions" — docs/plan/ROADMAP.md §Фаза 0). Fixed usernames/ids keep the
 * seed idempotent and reproducible across environments; roles are non-superadmin
 * templates from `@cuks/shared` spread across the org skeleton so reviewers can log
 * in as, e.g., `nazarova.n` (employee — no admin UI) vs `yusupov.f` (platform_admin
 * — sees "Администрирование"). `positionId` is fixed for the same reason `org.ts`
 * uses fixed org-unit ids: re-running the seed must not create duplicate rows.
 */
interface DemoUserSeed {
  positionId: string;
  fullName: string;
  shortName: string;
  username: string;
  orgUnitId: string;
  positionName: string;
  isHeadPosition: boolean;
  roleCode: string;
  /** platform_admin is IT-wide, not tied to one department — assigned globally. */
  roleScopeGlobal?: boolean;
}

const DEMO_USERS: readonly DemoUserSeed[] = [
  // Центральный аппарат (002)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000001',
    fullName: 'Раҳимов Далер Саидович',
    shortName: 'Д.С. Раҳимов',
    username: 'rahimov.d',
    orgUnitId: '0190a000-0000-7000-8000-000000000002',
    positionName: 'Начальник аппарата',
    isHeadPosition: true,
    roleCode: 'chief',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000002',
    fullName: 'Назарова Нигина Абдуллоевна',
    shortName: 'Н.А. Назарова',
    username: 'nazarova.n',
    orgUnitId: '0190a000-0000-7000-8000-000000000002',
    positionName: 'Ведущий специалист',
    isHeadPosition: false,
    roleCode: 'employee',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000003',
    fullName: 'Юсупов Фарход Камолович',
    shortName: 'Ф.К. Юсупов',
    username: 'yusupov.f',
    orgUnitId: '0190a000-0000-7000-8000-000000000002',
    positionName: 'Администратор платформы',
    isHeadPosition: false,
    roleCode: 'platform_admin',
    roleScopeGlobal: true,
  },
  // Управление защиты населения (003)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000004',
    fullName: 'Каримов Умед Раджабович',
    shortName: 'У.Р. Каримов',
    username: 'karimov.u',
    orgUnitId: '0190a000-0000-7000-8000-000000000003',
    positionName: 'Начальник управления',
    isHeadPosition: true,
    roleCode: 'chief',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000005',
    fullName: 'Латифи Зарина Достиевна',
    shortName: 'З.Д. Латифи',
    username: 'latifi.z',
    orgUnitId: '0190a000-0000-7000-8000-000000000003',
    positionName: 'Оперативный дежурный',
    isHeadPosition: false,
    roleCode: 'duty_officer',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000006',
    fullName: 'Шарипова Мадина Носировна',
    shortName: 'М.Н. Шарипова',
    username: 'sharipova.m',
    orgUnitId: '0190a000-0000-7000-8000-000000000003',
    positionName: 'Ведущий специалист',
    isHeadPosition: false,
    roleCode: 'employee',
  },
  // Управление гражданской обороны (004)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000007',
    fullName: 'Давлатов Сино Абдуллоевич',
    shortName: 'С.А. Давлатов',
    username: 'davlatov.s',
    orgUnitId: '0190a000-0000-7000-8000-000000000004',
    positionName: 'Начальник управления',
    isHeadPosition: true,
    roleCode: 'chief',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000008',
    fullName: 'Одинаева Дилноза Файзуллоевна',
    shortName: 'Д.Ф. Одинаева',
    username: 'odinaeva.d',
    orgUnitId: '0190a000-0000-7000-8000-000000000004',
    positionName: 'Специалист по ГО',
    isHeadPosition: false,
    roleCode: 'employee',
  },
  // Канцелярия (005)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000009',
    fullName: 'Набиева Гулнора Саидовна',
    shortName: 'Г.С. Набиева',
    username: 'nabieva.g',
    orgUnitId: '0190a000-0000-7000-8000-000000000005',
    positionName: 'Заведующая канцелярией',
    isHeadPosition: true,
    roleCode: 'clerk',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-00000000000a',
    fullName: 'Мирзоев Бахтиёр Хушвахтович',
    shortName: 'Б.Х. Мирзоев',
    username: 'mirzoev.b',
    orgUnitId: '0190a000-0000-7000-8000-000000000005',
    positionName: 'Делопроизводитель',
    isHeadPosition: false,
    roleCode: 'clerk',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-00000000000b',
    fullName: 'Тагоева Шахло Джумаевна',
    shortName: 'Ш.Д. Тагоева',
    username: 'tagoeva.s',
    orgUnitId: '0190a000-0000-7000-8000-000000000005',
    positionName: 'Делопроизводитель',
    isHeadPosition: false,
    roleCode: 'clerk',
  },
  // Управление по Согдийской области (006)
  {
    positionId: '0190a0d0-0000-7000-8000-00000000000c',
    fullName: 'Рустамов Шерали Назарович',
    shortName: 'Ш.Н. Рустамов',
    username: 'rustamov.s',
    orgUnitId: '0190a000-0000-7000-8000-000000000006',
    positionName: 'Начальник управления',
    isHeadPosition: true,
    roleCode: 'chief',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-00000000000d',
    fullName: 'Файзуллоева Малика Толибовна',
    shortName: 'М.Т. Файзуллоева',
    username: 'fayzulloeva.m',
    orgUnitId: '0190a000-0000-7000-8000-000000000006',
    positionName: 'Ведущий специалист',
    isHeadPosition: false,
    roleCode: 'employee',
  },
  // Отдел по г. Худжанд (007)
  {
    positionId: '0190a0d0-0000-7000-8000-00000000000e',
    fullName: 'Нозимов Хуршед Абдугафурович',
    shortName: 'Х.А. Нозимов',
    username: 'nozimov.h',
    orgUnitId: '0190a000-0000-7000-8000-000000000007',
    positionName: 'Начальник отдела',
    isHeadPosition: true,
    roleCode: 'duty_officer',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-00000000000f',
    fullName: 'Саидова Фарзона Муродовна',
    shortName: 'Ф.М. Саидова',
    username: 'saidova.f',
    orgUnitId: '0190a000-0000-7000-8000-000000000007',
    positionName: 'Специалист',
    isHeadPosition: false,
    roleCode: 'employee',
  },
  // Управление по Хатлонской области (008)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000010',
    fullName: 'Абдуллоев Зафар Раҳматович',
    shortName: 'З.Р. Абдуллоев',
    username: 'abdulloev.z',
    orgUnitId: '0190a000-0000-7000-8000-000000000008',
    positionName: 'Начальник управления',
    isHeadPosition: true,
    roleCode: 'chief',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000011',
    fullName: 'Каримова Ойша Файзуллоевна',
    shortName: 'О.Ф. Каримова',
    username: 'karimova.o',
    orgUnitId: '0190a000-0000-7000-8000-000000000008',
    positionName: 'Оперативный дежурный',
    isHeadPosition: false,
    roleCode: 'duty_officer',
  },
  // Управление по ГБАО (009)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000012',
    fullName: 'Шоев Умарали Давлатович',
    shortName: 'У.Д. Шоев',
    username: 'shoev.u',
    orgUnitId: '0190a000-0000-7000-8000-000000000009',
    positionName: 'Начальник управления',
    isHeadPosition: true,
    roleCode: 'chief',
  },
  {
    positionId: '0190a0d0-0000-7000-8000-000000000013',
    fullName: 'Гуломова Саодат Назаровна',
    shortName: 'С.Н. Гуломова',
    username: 'gulomova.s',
    orgUnitId: '0190a000-0000-7000-8000-000000000009',
    positionName: 'Специалист ГИС',
    isHeadPosition: false,
    roleCode: 'gis_analyst',
  },
  // Управления и отделы РРП (00a)
  {
    positionId: '0190a0d0-0000-7000-8000-000000000014',
    fullName: 'Холов Джамшед Саидович',
    shortName: 'Д.С. Холов',
    username: 'kholov.j',
    orgUnitId: '0190a000-0000-7000-8000-00000000000a',
    positionName: 'Начальник управления',
    isHeadPosition: true,
    roleCode: 'chief',
  },
];

/**
 * Demo users log in directly (`mustChangePassword: false`) with one shared,
 * documented password — unlike real onboarding (temp password + forced change),
 * this is deliberately frictionless so the roster can be handed to reviewers/
 * leadership as-is (decision recorded in docs/plan/STATUS.md). Roles carrying
 * `docflow.sign`/`admin.*`/`gis.pg.access` still force TOTP enrollment on first
 * login (docs/09 §1) — that guard is not weakened for demo accounts.
 */
async function seedDemoUsers(db: Database): Promise<void> {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, ...ARGON2_OPTIONS });
  const roleIdByCode = new Map<string, string>();

  for (const entry of DEMO_USERS) {
    await db
      .insert(positions)
      .values({
        id: entry.positionId,
        orgUnitId: entry.orgUnitId,
        name: entry.positionName,
        isHead: entry.isHeadPosition,
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        username: entry.username,
        passwordHash,
        fullName: entry.fullName,
        shortName: entry.shortName,
        mustChangePassword: false,
        status: 'active',
      })
      .onConflictDoNothing();
    const [user] = await db.select().from(users).where(eq(users.username, entry.username));
    if (!user) throw new Error(`Failed to create or find demo user "${entry.username}"`);

    await db
      .insert(userPositions)
      .values({ userId: user.id, positionId: entry.positionId, isPrimary: true })
      .onConflictDoNothing();

    if (entry.isHeadPosition) {
      await db
        .update(orgUnits)
        .set({ headPositionId: entry.positionId })
        .where(eq(orgUnits.id, entry.orgUnitId));
    }

    let roleId = roleIdByCode.get(entry.roleCode);
    if (!roleId) {
      const [role] = await db.select().from(roles).where(eq(roles.code, entry.roleCode));
      if (!role)
        throw new Error(`Demo role "${entry.roleCode}" missing — seedRoles must run first`);
      roleId = role.id;
      roleIdByCode.set(entry.roleCode, roleId);
    }
    await db
      .insert(userRoles)
      .values({
        userId: user.id,
        roleId,
        orgUnitId: entry.roleScopeGlobal ? null : entry.orgUnitId,
      })
      .onConflictDoNothing();
  }

  console.log(
    `Demo seed complete: ${DEMO_USERS.length} users (password: "${password}", ` +
      `mustChangePassword: false). Try "nazarova.n" (employee) vs "yusupov.f" ` +
      `(platform_admin) to see the permission-gated UI difference.`,
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const isDemo = process.argv.includes('--demo');
  if (isDemo && process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo users (well-known password) with NODE_ENV=production');
  }
  if (!url) throw new Error('DATABASE_URL is required for seeding');

  const { db, pool } = createDb(url);
  try {
    await seedRoles(db);
    await seedOrg(db);
    const adminId = await seedAdmin(db);
    await assignSuperadmin(db, adminId);
    await seedDictionaries(db);
    await seedDemoNotifications(db, adminId);
    console.log(
      `Seed complete: ${ROLE_TEMPLATES.length} roles, ${ORG_SKELETON.length} org units, ` +
        `admin user "${ADMIN_USERNAME}", ${DICTIONARIES.length} dictionary entries.`,
    );
    if (isDemo) await seedDemoUsers(db);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
