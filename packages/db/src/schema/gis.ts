import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ADMIN_UNIT_LEVELS, GIS_LAYER_KINDS, GIS_SRID, type GeometryType } from '@cuks/shared';
import { createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { orgUnits } from './org';
import { users } from './users';

/** Spatial schema, kept separate from `app` so QGIS/ArcGIS get direct, scoped DB
 *  access to it alone (docs/07 §gis, docs/modules/10 §7). */
export const gisSchema = pgSchema('gis');

/**
 * PostGIS `geometry(<Type>, <srid>)` column (docs/07 §gis: everything stored in
 * WGS84 / 4326). The app reads/writes via ST_AsGeoJSON / ST_GeomFromGeoJSON in
 * raw SQL and Martin builds MVT straight from the column, so the TS `data` type
 * is nominal (the raw value is EWKB). Requires the `postgis` extension (created
 * in the migration ahead of these tables).
 */
export function geometry(name: string, type: GeometryType = 'Geometry', srid: number = GIS_SRID) {
  return customType<{ data: string; driverData: string }>({
    dataType() {
      return `geometry(${type},${srid})`;
    },
  })(name);
}

/**
 * gis.admin_units — administrative division (region → district → jamoat) with
 * boundary geometry + population (docs/modules/10 §3). Loaded by seed-geo
 * (infra/scripts/seed-geo.sh) from official/OSM shapes.
 */
export const adminUnits = gisSchema.table(
  'admin_units',
  {
    id: primaryId(),
    parentId: uuid('parent_id'),
    level: text('level', { enum: ADMIN_UNIT_LEVELS }).notNull(),
    code: text('code').notNull(),
    nameRu: text('name_ru').notNull(),
    nameTg: text('name_tg').notNull(),
    population: integer('population'),
    geom: geometry('geom', 'MultiPolygon').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('admin_units_code_uq').on(t.code),
    index('admin_units_parent_idx').on(t.parentId),
    index('admin_units_level_idx').on(t.level),
    index('admin_units_geom_gix').using('gist', t.geom),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'admin_units_parent_fk',
    }).onDelete('restrict'),
    check('admin_units_level_chk', sql`${t.level} in ('region', 'district', 'jamoat')`),
  ],
);

/** gis.facilities — infrastructure objects (schools, hospitals, ПВР, bridges…),
 *  point geometry + free-form attrs (docs/modules/10 §3). */
export const facilities = gisSchema.table(
  'facilities',
  {
    id: primaryId(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    geom: geometry('geom', 'Point').notNull(),
    attrs: jsonb('attrs')
      .notNull()
      .default(sql`'{}'::jsonb`),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('facilities_geom_gix').using('gist', t.geom),
    index('facilities_kind_idx').on(t.kind),
  ],
);

/** gis.risk_zones — hazard zones (flood/landslide/…), polygon + level 1–5
 *  (docs/modules/10 §3). */
export const riskZones = gisSchema.table(
  'risk_zones',
  {
    id: primaryId(),
    hazardCode: text('hazard_code').notNull(),
    name: text('name').notNull(),
    level: integer('level').notNull(),
    geom: geometry('geom', 'MultiPolygon').notNull(),
    attrs: jsonb('attrs')
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: text('source'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('risk_zones_geom_gix').using('gist', t.geom),
    index('risk_zones_hazard_idx').on(t.hazardCode),
    check('risk_zones_level_chk', sql`${t.level} between 1 and 5`),
  ],
);

/**
 * gis.layers — layer registry (docs/modules/10 §3). `system` layers are the
 * built-in tables (admin_units/incidents/facilities/risk_zones); `imported`
 * layers point at a physical `gis.l_<slug>` table (`table_name`); `drawn` layers
 * store features in gis.layer_features. Per-layer ACL via `resource_acl`
 * (resource_type `layer`). Soft-deleted (user-managed).
 */
export const gisLayers = gisSchema.table(
  'layers',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: GIS_LAYER_KINDS }).notNull(),
    geometryType: text('geometry_type'),
    tableName: text('table_name'),
    style: jsonb('style')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isPublishedWms: boolean('is_published_wms').notNull().default(false),
    /** GeoServer layer name once published (task 2.9); null while unpublished. */
    geoserverLayer: text('geoserver_layer'),
    minZoom: integer('min_zoom'),
    maxZoom: integer('max_zoom'),
    description: text('description'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Partial unique on live rows only — a soft-deleted layer must not permanently
    // burn its slug (same convention as other soft-deleted tables).
    uniqueIndex('layers_slug_uq')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('layers_kind_idx').on(t.kind),
    check('layers_kind_chk', sql`${t.kind} in ('system', 'imported', 'drawn')`),
  ],
);

/** gis.layer_features — features of a `drawn` layer (web-drawn objects,
 *  docs/modules/10 §3). */
export const layerFeatures = gisSchema.table(
  'layer_features',
  {
    id: primaryId(),
    layerId: uuid('layer_id')
      .notNull()
      .references(() => gisLayers.id, { onDelete: 'cascade' }),
    geom: geometry('geom', 'Geometry').notNull(),
    props: jsonb('props')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('layer_features_geom_gix').using('gist', t.geom),
    index('layer_features_layer_idx').on(t.layerId),
  ],
);
