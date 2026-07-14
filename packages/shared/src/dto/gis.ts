import { z } from 'zod';
import {
  GIS_EXPORT_FORMATS,
  GIS_EXPORT_SOURCES,
  type GisExportFormat,
  type GisExportSource,
  type GisExportStatus,
  type GisImportStatus,
  type GisLayerKind,
} from '../enums/index';
import { incidentRegistryFilterSchema } from './incidents';

/** Tile-access token issued on map load (docs/modules/10 §9). The client appends
 *  it as `?token=` to Martin tile requests; Caddy forward_auth validates it. */
export interface TileTokenResponse {
  token: string;
  /** ISO instant the token expires. */
  expiresAt: string;
}

/** Selectable leaf in the incident-type dictionary tree. Parent metadata lets
 * the map UI present the flat select as a readable grouped hierarchy. */
export interface IncidentTypeFilterOption {
  code: string;
  parentCode: string | null;
  nameRu: string;
  nameTg: string;
  parentNameRu: string | null;
  parentNameTg: string | null;
}

/** Administrative region available to the incident map filter. */
export interface IncidentRegionFilterOption {
  id: string;
  code: string;
  nameRu: string;
  nameTg: string;
}

/** Reference data for `/gis/incidents/filter-options`. */
export interface IncidentMapFilterOptionsResponse {
  types: IncidentTypeFilterOption[];
  regions: IncidentRegionFilterOption[];
}

// --- Layer registry + drawn features (docs/modules/10 §3/§4/§9; task 2.7) ---

/**
 * A WGS84 position; PostGIS stores everything in 4326 (docs/07 §gis). Strictly
 * two-dimensional: the `geometry(...,4326)` columns carry no Z, and a coordinate
 * with an altitude would be rejected by the column ("Geometry has Z dimension but
 * column does not") — a 500 where a validation error belongs.
 */
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** A linear ring: ≥ 4 positions, first == last (PostGIS closes an open ring, but
 *  then the object stored is not the one that was sent). */
const ring = z
  .array(position)
  .min(4)
  .refine((positions) => {
    const first = positions[0];
    const last = positions[positions.length - 1];
    return !!first && !!last && first[0] === last[0] && first[1] === last[1];
  }, 'Linear ring must be closed (first and last position equal)');

/**
 * GeoJSON geometry accepted from the client (drawn with terra-draw). Validated
 * structurally here so a malformed shape never reaches ST_GeomFromGeoJSON as a
 * raw 500 (docs/04 §REST: zod at the edge).
 */
export const geoJsonGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position).min(1) }),
  z.object({
    type: z.literal('MultiLineString'),
    coordinates: z.array(z.array(position).min(2)).min(1),
  }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
export type GeoJsonGeometry = z.infer<typeof geoJsonGeometrySchema>;

/** Free-form feature attributes (`gis.layer_features.props`). */
export const featurePropsSchema = z.record(z.string(), z.unknown());

/** Layer of the registry (`gis.layers`). `canEdit`/`canManage` are the caller's
 *  own capabilities (resource_acl `layer`), so the UI can gate the draw tools. */
export interface GisLayerDto {
  id: string;
  slug: string;
  title: string;
  kind: GisLayerKind;
  geometryType: string | null;
  style: Record<string, unknown>;
  description: string | null;
  minZoom: number | null;
  maxZoom: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canManage: boolean;
}

/** Geometry a drawn layer accepts; `Geometry` allows any of them. */
export const DRAWN_LAYER_GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'Geometry'] as const;
export type DrawnLayerGeometryType = (typeof DRAWN_LAYER_GEOMETRY_TYPES)[number];

/** Create a `drawn` layer. The slug is derived from the title server-side. */
export const createGisLayerSchema = z.object({
  title: z.string().trim().min(1).max(200),
  geometryType: z.enum(DRAWN_LAYER_GEOMETRY_TYPES).default('Geometry'),
  description: z.string().trim().max(1000).optional(),
  style: z.record(z.string(), z.unknown()).default({}),
});
export type CreateGisLayerInput = z.infer<typeof createGisLayerSchema>;

export const patchGisLayerSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required',
  });
export type PatchGisLayerInput = z.infer<typeof patchGisLayerSchema>;

/** A feature of a drawn layer (`gis.layer_features`), as GeoJSON. */
export interface GisFeatureDto {
  id: string;
  layerId: string;
  geometry: GeoJsonGeometry;
  props: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const createGisFeatureSchema = z.object({
  layerId: z.string().uuid(),
  geometry: geoJsonGeometrySchema,
  props: featurePropsSchema.default({}),
});
export type CreateGisFeatureInput = z.infer<typeof createGisFeatureSchema>;

export const patchGisFeatureSchema = z
  .object({
    geometry: geoJsonGeometrySchema.optional(),
    props: featurePropsSchema.optional(),
  })
  .refine((v) => v.geometry !== undefined || v.props !== undefined, {
    message: 'geometry or props is required',
  });
export type PatchGisFeatureInput = z.infer<typeof patchGisFeatureSchema>;

/** `bbox` is `minLon,minLat,maxLon,maxLat` (the map viewport). */
export const gisFeaturesQuerySchema = z.object({
  layerId: z.string().uuid(),
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'bbox must be minLon,minLat,maxLon,maxLat')
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type GisFeaturesQuery = z.infer<typeof gisFeaturesQuerySchema>;

// --- Import / export of geodata (docs/modules/10 §6; task 2.8) ---

/** Hard ceiling on an uploaded source file. A shapefile of a whole country fits
 *  well inside this; anything larger belongs in a direct PostGIS load (§7). */
export const GIS_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** Features imported from one file. Beyond this the import is refused rather than
 *  silently truncated. */
export const GIS_IMPORT_MAX_FEATURES = 200_000;

/** One attribute column the worker found in the source file. */
export interface GisImportField {
  name: string;
  /** Postgres type the column was created with (`text`, `numeric`, …). */
  type: string;
}

/** What the wizard shows once the worker has read the file (docs/modules/10 §6:
 *  «предпросмотр (поля, число объектов, extent)»). */
export interface GisImportPreview {
  /** Name of the layer inside the source dataset. */
  sourceLayer: string;
  driver: string;
  geometryType: string;
  featureCount: number;
  /** How many features were skipped (invalid/empty geometry) — detailed in the log. */
  skippedCount: number;
  fields: GisImportField[];
  /** `[west, south, east, north]` in 4326, or null for an empty layer. */
  extent: [number, number, number, number] | null;
}

/** A geo-import record (`app.gis_imports`). */
export interface GisImportDto {
  id: string;
  status: GisImportStatus;
  sourceName: string | null;
  sizeBytes: number | null;
  layerId: string | null;
  preview: GisImportPreview | null;
  /** Per-row error log (docs/modules/10 §6: «Ошибки — построчный лог»). */
  log: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Step 1 of the wizard: reserve the record and get a presigned upload URL. */
export const createGisImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(GIS_IMPORT_MAX_BYTES),
  /** Title of the layer to create; defaults to the file name server-side. */
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateGisImportInput = z.infer<typeof createGisImportSchema>;

export interface CreateGisImportResponse {
  importId: string;
  /** Presigned PUT — the browser uploads straight to storage, as everywhere else. */
  uploadUrl: string;
}

/** A geo-export record (`app.gis_exports`). */
export interface GisExportDto {
  id: string;
  source: GisExportSource;
  format: GisExportFormat;
  status: GisExportStatus;
  fileName: string | null;
  sizeBytes: number | null;
  featureCount: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Export a registry layer, or the incidents matching the registry filters. */
export const createGisExportSchema = z
  .object({
    source: z.enum(GIS_EXPORT_SOURCES),
    format: z.enum(GIS_EXPORT_FORMATS),
    layerId: z.string().uuid().optional(),
    filters: incidentRegistryFilterSchema.optional(),
  })
  .refine((v) => v.source !== 'layer' || !!v.layerId, {
    message: 'layerId is required for a layer export',
    path: ['layerId'],
  });
export type CreateGisExportInput = z.infer<typeof createGisExportSchema>;
