import { config as loadEnv } from 'dotenv';

// Seeds run from packages/db; load the monorepo-root .env for DATABASE_URL.
loadEnv({ path: ['.env', '../../.env'] });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import argon2 from 'argon2';
import { count, eq, sql } from 'drizzle-orm';
import { ARGON2_OPTIONS, ROLE_TEMPLATES, keysBetween, type OrgUnitType } from '@cuks/shared';
import { createDb, type Database } from './client';
import {
  adminUnits,
  chatChannels,
  chatMembers,
  dictionaries,
  incidents,
  journals,
  nomenclature,
  notifications,
  orgUnits,
  positions,
  rolePermissions,
  roles,
  taskColumns,
  taskProjectMembers,
  taskProjects,
  tasks,
  userPositions,
  userRoles,
  users,
} from './schema/index';
import { chatMessages } from './unmanaged/chat-messages';
import { and, inArray, isNull } from 'drizzle-orm';

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
  { type: 'doc_type', code: 'letter', nameRu: 'Письмо', sort: 6 },
  { type: 'doc_type', code: 'memo', nameRu: 'Служебная записка', sort: 7 },
  { type: 'doc_type', code: 'protocol', nameRu: 'Протокол', sort: 8 },
  { type: 'doc_type', code: 'citizen_appeal', nameRu: 'Обращение гражданина', sort: 9 },
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
  // Виды ЧС — полное дерево 2–3 уровней (docs/modules/10 §2). Коды стабильные.
  { type: 'incident_type', code: 'natural', nameRu: 'Природная ЧС', sort: 1 },
  { type: 'incident_type', code: 'technogenic', nameRu: 'Техногенная ЧС', sort: 2 },
  { type: 'incident_type', code: 'biosocial', nameRu: 'Биолого-социальная ЧС', sort: 3 },

  // Природные → группы
  {
    type: 'incident_type',
    code: 'nat.geophys',
    parentCode: 'natural',
    nameRu: 'Геофизические',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'nat.geo',
    parentCode: 'natural',
    nameRu: 'Геологические',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'nat.hydro',
    parentCode: 'natural',
    nameRu: 'Гидрологические',
    sort: 3,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo',
    parentCode: 'natural',
    nameRu: 'Метеорологические',
    sort: 4,
  },
  {
    type: 'incident_type',
    code: 'nat.fire',
    parentCode: 'natural',
    nameRu: 'Природные пожары',
    sort: 5,
  },
  // Геофизические
  {
    type: 'incident_type',
    code: 'nat.geophys.earthquake',
    parentCode: 'nat.geophys',
    nameRu: 'Землетрясение',
    sort: 1,
  },
  // Геологические
  {
    type: 'incident_type',
    code: 'nat.geo.landslide',
    parentCode: 'nat.geo',
    nameRu: 'Оползень',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'nat.geo.mudflow',
    parentCode: 'nat.geo',
    nameRu: 'Сель',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'nat.geo.avalanche',
    parentCode: 'nat.geo',
    nameRu: 'Лавина',
    sort: 3,
  },
  {
    type: 'incident_type',
    code: 'nat.geo.rockfall',
    parentCode: 'nat.geo',
    nameRu: 'Обвал/осыпь',
    sort: 4,
  },
  {
    type: 'incident_type',
    code: 'nat.geo.subsidence',
    parentCode: 'nat.geo',
    nameRu: 'Просадка грунта',
    sort: 5,
  },
  // Гидрологические
  {
    type: 'incident_type',
    code: 'nat.hydro.freshet',
    parentCode: 'nat.hydro',
    nameRu: 'Паводок',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'nat.hydro.flood',
    parentCode: 'nat.hydro',
    nameRu: 'Наводнение',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'nat.hydro.waterlogging',
    parentCode: 'nat.hydro',
    nameRu: 'Подтопление',
    sort: 3,
  },
  {
    type: 'incident_type',
    code: 'nat.hydro.glof',
    parentCode: 'nat.hydro',
    nameRu: 'Прорыв ледникового озера',
    sort: 4,
  },
  // Метеорологические
  {
    type: 'incident_type',
    code: 'nat.meteo.downpour',
    parentCode: 'nat.meteo',
    nameRu: 'Ливень',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.hail',
    parentCode: 'nat.meteo',
    nameRu: 'Град',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.windstorm',
    parentCode: 'nat.meteo',
    nameRu: 'Ураганный ветер',
    sort: 3,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.snowfall',
    parentCode: 'nat.meteo',
    nameRu: 'Снегопад',
    sort: 4,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.frost',
    parentCode: 'nat.meteo',
    nameRu: 'Мороз',
    sort: 5,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.heat',
    parentCode: 'nat.meteo',
    nameRu: 'Жара',
    sort: 6,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.drought',
    parentCode: 'nat.meteo',
    nameRu: 'Засуха',
    sort: 7,
  },
  {
    type: 'incident_type',
    code: 'nat.meteo.fog',
    parentCode: 'nat.meteo',
    nameRu: 'Туман',
    sort: 8,
  },

  // Техногенные → группы
  {
    type: 'incident_type',
    code: 'tech.transport',
    parentCode: 'technogenic',
    nameRu: 'Транспортные аварии',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'tech.fire_explosion',
    parentCode: 'technogenic',
    nameRu: 'Пожары и взрывы в зданиях',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'tech.power',
    parentCode: 'technogenic',
    nameRu: 'Аварии энергосистем',
    sort: 3,
  },
  {
    type: 'incident_type',
    code: 'tech.utilities',
    parentCode: 'technogenic',
    nameRu: 'Аварии ЖКХ (вода/тепло/газ)',
    sort: 4,
  },
  {
    type: 'incident_type',
    code: 'tech.chemical',
    parentCode: 'technogenic',
    nameRu: 'Аварии с химически опасными веществами',
    sort: 5,
  },
  {
    type: 'incident_type',
    code: 'tech.collapse',
    parentCode: 'technogenic',
    nameRu: 'Обрушения зданий и сооружений',
    sort: 6,
  },
  {
    type: 'incident_type',
    code: 'tech.hydrodynamic',
    parentCode: 'technogenic',
    nameRu: 'Гидродинамические аварии (прорыв дамб)',
    sort: 7,
  },
  // Транспортные аварии
  {
    type: 'incident_type',
    code: 'tech.transport.road',
    parentCode: 'tech.transport',
    nameRu: 'ДТП с тяжкими последствиями',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'tech.transport.aviation',
    parentCode: 'tech.transport',
    nameRu: 'Авиационная авария',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'tech.transport.railway',
    parentCode: 'tech.transport',
    nameRu: 'Железнодорожная авария',
    sort: 3,
  },

  // Биолого-социальные
  {
    type: 'incident_type',
    code: 'bio.epidemic',
    parentCode: 'biosocial',
    nameRu: 'Эпидемия',
    sort: 1,
  },
  {
    type: 'incident_type',
    code: 'bio.epizootic',
    parentCode: 'biosocial',
    nameRu: 'Эпизоотия',
    sort: 2,
  },
  {
    type: 'incident_type',
    code: 'bio.epiphytotic',
    parentCode: 'biosocial',
    nameRu: 'Эпифитотия',
    sort: 3,
  },
  {
    type: 'incident_type',
    code: 'bio.poisoning',
    parentCode: 'biosocial',
    nameRu: 'Массовое отравление',
    sort: 4,
  },
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

/** Standard registration journals (docs/modules/11 §1). Fixed ids keep the seed
 *  idempotent; `{ПРЕФИКС}-{YYYY}/{seq4}` renders e.g. `ВХ-2026/0001`. */
const DOCFLOW_JOURNALS: ReadonlyArray<{
  id: string;
  code: string;
  name: string;
  docClass: 'incoming' | 'outgoing' | 'internal' | 'citizens';
  numberTemplate: string;
  sort: number;
}> = [
  {
    id: '0190d0c0-0000-7000-8000-000000000001',
    code: 'incoming',
    name: 'Входящие документы',
    docClass: 'incoming',
    numberTemplate: '{ВХ}-{YYYY}/{seq4}',
    sort: 1,
  },
  {
    id: '0190d0c0-0000-7000-8000-000000000002',
    code: 'outgoing',
    name: 'Исходящие документы',
    docClass: 'outgoing',
    numberTemplate: '{ИСХ}-{YYYY}/{seq4}',
    sort: 2,
  },
  {
    id: '0190d0c0-0000-7000-8000-000000000003',
    code: 'orders',
    name: 'Приказы',
    docClass: 'internal',
    numberTemplate: '{П}-{YYYY}/{seq4}',
    sort: 3,
  },
  {
    id: '0190d0c0-0000-7000-8000-000000000004',
    code: 'directives',
    name: 'Распоряжения',
    docClass: 'internal',
    numberTemplate: '{Р}-{YYYY}/{seq4}',
    sort: 4,
  },
  {
    id: '0190d0c0-0000-7000-8000-000000000005',
    code: 'memos',
    name: 'Служебные записки',
    docClass: 'internal',
    numberTemplate: '{СЗ}-{YYYY}/{seq4}',
    sort: 5,
  },
  {
    id: '0190d0c0-0000-7000-8000-000000000006',
    code: 'protocols',
    name: 'Протоколы',
    docClass: 'internal',
    numberTemplate: '{ПР}-{YYYY}/{seq4}',
    sort: 6,
  },
  {
    id: '0190d0c0-0000-7000-8000-000000000007',
    code: 'citizens',
    name: 'Обращения граждан',
    docClass: 'citizens',
    numberTemplate: '{ОГ}-{YYYY}/{seq4}',
    sort: 7,
  },
];

/** Baseline case-index nomenclature (docs/modules/11 §1). Fixed ids, idempotent. */
const DOCFLOW_NOMENCLATURE: ReadonlyArray<{
  id: string;
  index: string;
  title: string;
  sort: number;
}> = [
  {
    id: '0190d0c1-0000-7000-8000-000000000001',
    index: '01-01',
    title: 'Приказы по основной деятельности',
    sort: 1,
  },
  { id: '0190d0c1-0000-7000-8000-000000000002', index: '01-05', title: 'Распоряжения', sort: 2 },
  {
    id: '0190d0c1-0000-7000-8000-000000000003',
    index: '02-01',
    title: 'Входящая корреспонденция',
    sort: 3,
  },
  {
    id: '0190d0c1-0000-7000-8000-000000000004',
    index: '02-02',
    title: 'Исходящая корреспонденция',
    sort: 4,
  },
  {
    id: '0190d0c1-0000-7000-8000-000000000005',
    index: '03-01',
    title: 'Протоколы совещаний',
    sort: 5,
  },
  {
    id: '0190d0c1-0000-7000-8000-000000000006',
    index: '04-01',
    title: 'Обращения граждан',
    sort: 6,
  },
];

/** Docflow reference data (task 3.1): registration journals + case-index nomenclature. */
async function seedDocflow(db: Database): Promise<void> {
  for (const j of DOCFLOW_JOURNALS) {
    await db
      .insert(journals)
      .values({
        id: j.id,
        code: j.code,
        name: j.name,
        docClass: j.docClass,
        numberTemplate: j.numberTemplate,
        seqReset: 'yearly',
        sort: j.sort,
      })
      .onConflictDoNothing();
  }
  for (const n of DOCFLOW_NOMENCLATURE) {
    await db
      .insert(nomenclature)
      .values({ id: n.id, index: n.index, title: n.title, sort: n.sort })
      .onConflictDoNothing();
  }
  console.log(
    `Docflow reference seeded: ${DOCFLOW_JOURNALS.length} journals, ${DOCFLOW_NOMENCLATURE.length} nomenclature entries.`,
  );
}

/**
 * Region metadata keyed by the geoBoundaries ADM1 ISO code. Population is an
 * approximate recent official figure (persons); exact/updated numbers come with
 * the full seed-geo import (infra/scripts/seed-geo.sh). name_tg is a RU
 * placeholder until real translations land (CLAUDE.md §4).
 */
const TJ_REGIONS: Record<string, { nameRu: string; population: number }> = {
  'TJ-SU': { nameRu: 'Согдийская область', population: 2_809_000 },
  'TJ-KT': { nameRu: 'Хатлонская область', population: 3_596_000 },
  'TJ-GB': { nameRu: 'Горно-Бадахшанская автономная область', population: 228_000 },
  'TJ-RA': { nameRu: 'Районы республиканского подчинения', population: 2_264_000 },
  'TJ-DU': { nameRu: 'город Душанбе', population: 863_400 },
};

interface GeoFeature {
  properties: { shapeISO?: string; shapeName?: string };
  geometry: unknown;
}

/**
 * Administrative boundaries (docs/modules/10 §3). Loads Tajikistan's regions
 * (ADM1) from a committed simplified GeoJSON so the map / region-detection work
 * out of the box; the full region→district→jamoat import with precise geometry
 * is the production path in infra/scripts/seed-geo.sh (ogr2ogr). Geometry is
 * coerced to MultiPolygon in 4326. Idempotent by `code`.
 */
/** Regional управления responsible for a region (task 2.13 data-scoping). The
 *  central apparatus (001–005) stays null = sees everything. */
const ORG_TERRITORY: Record<string, string> = {
  '0190a000-0000-7000-8000-000000000006': 'TJ-SU', // Согдийская область
  '0190a000-0000-7000-8000-000000000007': 'TJ-SU', // Отдел по г. Худжанд (в Согде)
  '0190a000-0000-7000-8000-000000000008': 'TJ-KT', // Хатлонская область
  '0190a000-0000-7000-8000-000000000009': 'TJ-GB', // ГБАО
  '0190a000-0000-7000-8000-00000000000a': 'TJ-RA', // РРП
};

/** Bind regional org units to their `gis.admin_units` region, so incident scoping
 *  can confine a regional user to their territory (docs/modules/10 §1). */
async function bindOrgTerritory(db: Database): Promise<void> {
  const regions = await db
    .select({ id: adminUnits.id, code: adminUnits.code })
    .from(adminUnits)
    .where(eq(adminUnits.level, 'region'));
  const byCode = new Map(regions.map((r) => [r.code, r.id]));
  for (const [orgUnitId, code] of Object.entries(ORG_TERRITORY)) {
    const adminUnitId = byCode.get(code);
    if (adminUnitId) {
      await db.update(orgUnits).set({ adminUnitId }).where(eq(orgUnits.id, orgUnitId));
    }
  }
  console.log('Org-unit territory bound: regional управления → admin_units.');
}

async function seedGeo(db: Database): Promise<void> {
  const path = join(__dirname, 'data', 'tj-admin1.geojson');
  const fc = JSON.parse(readFileSync(path, 'utf8')) as { features: GeoFeature[] };
  for (const f of fc.features) {
    const iso = f.properties.shapeISO;
    const meta = iso ? TJ_REGIONS[iso] : undefined;
    if (!iso || !meta) continue; // skip anything not in our region map
    const geom = sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326))`;
    await db
      .insert(adminUnits)
      .values({
        level: 'region',
        code: iso,
        nameRu: meta.nameRu,
        nameTg: meta.nameRu,
        population: meta.population,
        geom,
      })
      .onConflictDoUpdate({
        target: adminUnits.code,
        set: {
          nameRu: meta.nameRu,
          nameTg: meta.nameRu,
          population: meta.population,
          geom,
          updatedAt: new Date(),
        },
      });
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

const DEMO_INCIDENT_TYPES = [
  'nat.geo.landslide',
  'nat.hydro.flood',
  'nat.meteo.hail',
  'nat.geophys.earthquake',
  'tech.transport.road',
  'tech.fire_explosion',
  'bio.epidemic',
] as const;

const DEMO_INCIDENT_STATUSES = ['reported', 'active', 'localized', 'eliminated', 'closed'] as const;

const DEMO_REGION_CENTERS: Record<string, readonly [number, number]> = {
  'TJ-DU': [68.787, 38.559],
  'TJ-GB': [71.55, 38.3],
  'TJ-KT': [69.75, 37.85],
  'TJ-RA': [69.35, 39.05],
  'TJ-SU': [69.62, 40.28],
};

/** Fifty deterministic, spatially clustered incidents required by docs/07's
 * demo dataset. Dates are kept within the latest 45 days on every demo reseed
 * so the operational timeline always has useful out-of-the-box content. */
async function seedDemoIncidents(db: Database, adminId: string): Promise<void> {
  const regions = await db
    .select({ id: adminUnits.id, code: adminUnits.code })
    .from(adminUnits)
    .where(eq(adminUnits.level, 'region'));
  const usable = regions.filter((region) => DEMO_REGION_CENTERS[region.code]);
  if (usable.length === 0) throw new Error('Demo incidents require seeded administrative regions');

  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const region = usable[i % usable.length]!;
    const center = DEMO_REGION_CENTERS[region.code]!;
    // Small deterministic offsets form visible low-zoom clusters without random
    // seed drift. Every fifth point stays at the exact regional centre.
    const ring = i % 5;
    const lon = center[0] + (ring === 0 ? 0 : ((i % 3) - 1) * 0.018);
    const lat = center[1] + (ring === 0 ? 0 : (((i + 1) % 3) - 1) * 0.014);
    const number = `ЧС-DEMO-${String(i + 1).padStart(3, '0')}`;
    const occurredAt = new Date(now - (i % 45) * 86_400_000 - (i % 12) * 3_600_000);
    const severity = (i % 5) + 1;
    const status = DEMO_INCIDENT_STATUSES[i % DEMO_INCIDENT_STATUSES.length]!;
    const typeCode = DEMO_INCIDENT_TYPES[i % DEMO_INCIDENT_TYPES.length]!;
    const reportedAt = new Date(occurredAt.getTime() + 15 * 60_000);
    const closedAt = status === 'closed' ? reportedAt : null;
    // Deterministic casualty/damage figures scaled by severity, so the operational
    // summary KPIs read realistic (non-zero) numbers out of the box. Money is a
    // `numeric` string (CLAUDE.md §2 — never a float).
    const dead = severity >= 4 ? severity - 3 + (i % 2) : 0;
    const injured = severity * 2 + (i % 4);
    const evacuated = severity >= 3 ? severity * 15 + (i % 5) * 8 : 0;
    const affected = severity * 30 + (i % 7) * 12;
    const damageEst = (severity * 50_000 + (i % 9) * 12_500).toFixed(2);

    await db
      .insert(incidents)
      .values({
        number,
        typeCode,
        severity,
        status,
        occurredAt,
        reportedAt,
        regionId: region.id,
        geom: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
        addressText: `Демо-точка ${region.code}`,
        description: 'Демонстрационное происшествие для карты оперативной обстановки',
        source: 'monitoring',
        dead,
        injured,
        evacuated,
        affected,
        damageEst,
        createdBy: adminId,
        closedAt,
        closedBy: status === 'closed' ? adminId : null,
      })
      .onConflictDoUpdate({
        target: incidents.number,
        set: {
          typeCode,
          severity,
          status,
          occurredAt,
          reportedAt,
          regionId: region.id,
          geom: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
          dead,
          injured,
          evacuated,
          affected,
          damageEst,
          closedAt,
          closedBy: status === 'closed' ? adminId : null,
          updatedAt: new Date(),
          deletedAt: null,
        },
      });
  }
  console.log('Demo incident seed complete: 50 clustered incidents across Tajikistan.');
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

const OPS_PROJECT_ID = '0190a5c0-0000-7000-8000-000000000001';
const OPS_COLUMN_IDS = [
  '0190a5c0-0000-7000-8000-000000000002',
  '0190a5c0-0000-7000-8000-000000000003',
  '0190a5c0-0000-7000-8000-000000000004',
] as const;
const OPS_COLUMNS = ['К выполнению', 'В работе', 'Готово'] as const;
/** Duty officers who get editor on the shared board (attached only when the demo roster exists). */
const OPS_EDITOR_USERNAMES = ['latifi.z', 'nozimov.h', 'karimova.o'] as const;

/**
 * Default shared «Оперативные поручения» board (docs/modules/15 §6, task 4.5) — the project ЧС
 * «Создать задачу» links to. Idempotent via fixed ids; duty-officer editors attach when present.
 */
async function seedDefaultTaskProject(db: Database, adminId: string): Promise<void> {
  await db
    .insert(taskProjects)
    .values({
      id: OPS_PROJECT_ID,
      name: 'Оперативные поручения',
      key: 'ОПЕР',
      description: 'Поручения по оперативной обстановке и происшествиям',
      createdBy: adminId,
    })
    .onConflictDoNothing();

  const orderKeys = keysBetween(null, null, OPS_COLUMNS.length);
  for (let i = 0; i < OPS_COLUMNS.length; i++) {
    await db
      .insert(taskColumns)
      .values({
        id: OPS_COLUMN_IDS[i]!,
        projectId: OPS_PROJECT_ID,
        name: OPS_COLUMNS[i]!,
        orderKey: orderKeys[i]!,
        isDoneColumn: i === OPS_COLUMNS.length - 1,
      })
      .onConflictDoNothing();
  }

  await db
    .insert(taskProjectMembers)
    .values({ projectId: OPS_PROJECT_ID, userId: adminId, role: 'owner' })
    .onConflictDoNothing();
  for (const username of OPS_EDITOR_USERNAMES) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (!u) continue;
    await db
      .insert(taskProjectMembers)
      .values({ projectId: OPS_PROJECT_ID, userId: u.id, role: 'editor' })
      .onConflictDoNothing();
  }
  console.log('Default task project «Оперативные поручения» seeded (idempotent).');
}

/**
 * Provision the auto org-unit channels (docs/modules/13 §2, task 5.1) and sync each to its current
 * staff. Idempotent (the partial unique index makes a re-insert a no-op); re-run after demo users
 * exist so their memberships attach.
 */
async function seedOrgChannels(db: Database): Promise<void> {
  const units = await db
    .select({ id: orgUnits.id, name: orgUnits.name })
    .from(orgUnits)
    .where(isNull(orgUnits.deletedAt));
  let members = 0;
  for (const unit of units) {
    await db
      .insert(chatChannels)
      .values({ kind: 'org', name: unit.name, orgUnitId: unit.id })
      .onConflictDoNothing();
    const [channel] = await db
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(
        and(
          eq(chatChannels.orgUnitId, unit.id),
          eq(chatChannels.kind, 'org'),
          isNull(chatChannels.deletedAt),
        ),
      )
      .limit(1);
    if (!channel) continue;

    const staff = await db
      .selectDistinct({ userId: userPositions.userId })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .innerJoin(users, and(eq(users.id, userPositions.userId), isNull(users.deletedAt)))
      .where(eq(positions.orgUnitId, unit.id));
    const target = new Set(staff.map((s) => s.userId));
    const current = new Set(
      (
        await db
          .select({ userId: chatMembers.userId })
          .from(chatMembers)
          .where(eq(chatMembers.channelId, channel.id))
      ).map((m) => m.userId),
    );
    const toAdd = [...target].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !target.has(id));
    if (toAdd.length) {
      await db
        .insert(chatMembers)
        .values(
          toAdd.map((userId) => ({ channelId: channel.id, userId, memberRole: 'member' as const })),
        )
        .onConflictDoNothing();
      members += toAdd.length;
    }
    if (toRemove.length) {
      await db
        .delete(chatMembers)
        .where(and(eq(chatMembers.channelId, channel.id), inArray(chatMembers.userId, toRemove)));
    }
  }
  console.log(
    `Org-unit channels seeded: ${units.length} channels, +${members} members (idempotent).`,
  );
}

/** Minimal TipTap doc for a chat text message body (the renderer expects doc>paragraph>text). */
function textDoc(text: string): unknown {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const DEMO_TASK_ID = (n: number): string =>
  `0190a5c1-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** Board cards for the ops project (`col` = index into OPS_COLUMNS). */
const DEMO_TASKS = [
  {
    col: 0,
    title: 'Уточнить сводку по паводковой обстановке в Хатлонской области',
    prio: 'p2',
    who: 'latifi.z',
  },
  {
    col: 0,
    title: 'Подготовить проект распоряжения о готовности сил РСЧС',
    prio: 'p2',
    who: 'nazarova.n',
  },
  {
    col: 0,
    title: 'Проверить резерв ГСМ на складах длительного хранения',
    prio: 'p3',
    who: 'nozimov.h',
  },
  {
    col: 1,
    title: 'Организовать эвакуацию из зоны подтопления (джамоат Восеъ)',
    prio: 'p1',
    who: 'karimova.o',
  },
  {
    col: 1,
    title: 'Свести донесения районных управлений за прошедшие сутки',
    prio: 'p3',
    who: 'latifi.z',
  },
  { col: 2, title: 'Развернуть оперативный штаб КЧС', prio: 'p1', who: 'rahimov.d', done: true },
  {
    col: 2,
    title: 'Оповестить население через СМС-рассылку',
    prio: 'p2',
    who: 'nozimov.h',
    done: true,
  },
] as const;

/** A realistic operational chat thread for the central-apparatus channel. */
const DEMO_THREAD: readonly { who: string; text: string }[] = [
  {
    who: 'admin',
    text: 'Коллеги, по ЧС-DEMO-001 (паводок, Хатлон) собираем оперативную сводку к 14:00.',
  },
  { who: 'rahimov.d', text: 'Оперативный штаб развёрнут, дежурная смена на месте.' },
  { who: 'latifi.z', text: 'От управления Восеъ: подтоплено 12 домохозяйств, эвакуация начата.' },
  { who: 'karimova.o', text: 'Направили две группы спасателей и автоцистерну.' },
  { who: 'nazarova.n', text: 'Проект распоряжения о готовности сил РСЧС подготовлю к обеду.' },
  { who: 'nozimov.h', text: 'Резерв ГСМ проверен — в норме.' },
  { who: 'admin', text: 'Принято. СМС-оповещение населения запустили?' },
  { who: 'nozimov.h', text: 'Да, рассылка ушла по зоне подтопления.' },
];

const CENTRAL_APPARATUS_ORG_ID = '0190a000-0000-7000-8000-000000000002';

/**
 * Presentation-ready demo content across modules for a leadership walkthrough (task 7.8): board cards on
 * the ops project + a realistic ops chat thread. Idempotent — task ids are fixed (onConflictDoNothing) and
 * the thread is skipped if the channel already has messages. Runs only in `--demo` mode.
 */
async function seedDemoContent(db: Database, adminId: string): Promise<void> {
  // Look up the demo roster (created by seedDemoUsers) by username.
  const roster = await db.select({ id: users.id, username: users.username }).from(users);
  const idByUsername = new Map(roster.map((u) => [u.username, u.id]));
  idByUsername.set('admin', adminId);
  const resolve = (who: string): string => idByUsername.get(who) ?? adminId;

  // --- Board cards ---
  const now = new Date();
  // Idempotency: if the first demo card is already present, the demo content was seeded — skip everything.
  const [already] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, DEMO_TASK_ID(1)))
    .limit(1);
  if (already) {
    console.log('Demo content already present, skipping.');
    return;
  }
  // Fresh per-project seq numbers after any existing tasks (the ops project may already have real cards).
  const seqRows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${tasks.seq}), 0)` })
    .from(tasks)
    .where(eq(tasks.projectId, OPS_PROJECT_ID));
  const base = Number(seqRows[0]?.maxSeq ?? 0);
  const byColumn = new Map<number, number>(); // column index -> how many cards placed (for order keys)
  for (const [i, task] of DEMO_TASKS.entries()) {
    const inCol = byColumn.get(task.col) ?? 0;
    byColumn.set(task.col, inCol + 1);
    const orderInColumn = keysBetween(
      null,
      null,
      DEMO_TASKS.filter((t) => t.col === task.col).length,
    )[inCol]!;
    await db
      .insert(tasks)
      .values({
        id: DEMO_TASK_ID(i + 1),
        projectId: OPS_PROJECT_ID,
        columnId: OPS_COLUMN_IDS[task.col]!,
        seq: base + i + 1,
        title: task.title,
        authorId: adminId,
        assigneeIds: [resolve(task.who)],
        priority: task.prio,
        orderInColumn,
        ...('done' in task && task.done ? { completedAt: now } : {}),
        createdAt: now,
      })
      .onConflictDoNothing({ target: tasks.id });
  }
  await db
    .update(taskProjects)
    .set({ lastSeq: base + DEMO_TASKS.length })
    .where(eq(taskProjects.id, OPS_PROJECT_ID));

  // --- Ops chat thread (only if the channel is still empty, so re-seeding doesn't duplicate) ---
  const [channel] = await db
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .where(and(eq(chatChannels.orgUnitId, CENTRAL_APPARATUS_ORG_ID), eq(chatChannels.kind, 'org')))
    .limit(1);
  if (channel) {
    const [firstMsg] = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.channelId, channel.id))
      .limit(1);
    if (!firstMsg) {
      let lastAt = now;
      for (const [i, m] of DEMO_THREAD.entries()) {
        // Space messages over the last ~40 minutes so the feed reads naturally.
        const at = new Date(now.getTime() - (DEMO_THREAD.length - i) * 5 * 60 * 1000);
        lastAt = at;
        await db.insert(chatMessages).values({
          channelId: channel.id,
          authorId: resolve(m.who),
          kind: 'text',
          body: textDoc(m.text),
          bodyText: m.text,
          fileIds: [],
          createdAt: at,
        });
      }
      await db
        .update(chatChannels)
        .set({ lastMessageAt: lastAt })
        .where(eq(chatChannels.id, channel.id));
    }
  }

  console.log(`Demo content seeded: ${DEMO_TASKS.length} board cards, ops chat thread.`);
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
    await seedDocflow(db);
    await seedGeo(db);
    await bindOrgTerritory(db);
    await seedDemoNotifications(db, adminId);
    await seedDefaultTaskProject(db, adminId);
    await seedOrgChannels(db);
    console.log(
      `Seed complete: ${ROLE_TEMPLATES.length} roles, ${ORG_SKELETON.length} org units, ` +
        `admin user "${ADMIN_USERNAME}", ${DICTIONARIES.length} dictionary entries, ` +
        `admin boundaries (regions).`,
    );
    if (isDemo) {
      await seedDemoUsers(db);
      await seedDemoIncidents(db, adminId);
      // Re-run now that the demo roster exists, so duty officers attach as editors / channel members.
      await seedDefaultTaskProject(db, adminId);
      await seedOrgChannels(db);
      // Presentation content across modules (board cards + ops chat thread) — needs the roster/board/channels.
      await seedDemoContent(db, adminId);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
