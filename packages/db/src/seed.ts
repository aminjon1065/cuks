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
  rolePermissions,
  roles,
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

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for seeding');

  if (process.argv.includes('--demo')) {
    console.log('Demo seeds (20 users, incidents, …) are implemented in a later phase.');
  }

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
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
