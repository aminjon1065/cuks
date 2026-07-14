import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { gisLayers, layerFeatures, type Database } from '@cuks/db';
import type {
  CreateGisFeatureInput,
  GeoJsonGeometry,
  GisFeatureDto,
  GisFeaturesQuery,
  PatchGisFeatureInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { GisLayersService } from './gis-layers.service';

/** Row shape of a feature read back with its geometry as GeoJSON text. */
interface FeatureRow {
  id: string;
  layerId: string;
  geojson: string;
  props: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A layer declaring `Point`/`LineString`/`Polygon` accepts that type and its
 *  Multi- variant; `Geometry` (the default) accepts anything. */
function geometryAllowed(layerType: string | null, geometry: GeoJsonGeometry): boolean {
  if (!layerType || layerType === 'Geometry') return true;
  return geometry.type === layerType || geometry.type === `Multi${layerType}`;
}

/**
 * Features of `drawn` layers (gis.layer_features, docs/modules/10 §3/§4/§9;
 * task 2.7). Geometry travels as GeoJSON and is stored via ST_GeomFromGeoJSON in
 * 4326. Writes require `editor` on the layer (per-layer ACL); every geometry
 * change is audited with the previous geometry in `meta.prevGeom` (§4:
 * "с историей (аудит + prev_geom в meta)").
 */
@Injectable()
export class GisFeaturesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly layers: GisLayersService,
    private readonly audit: AuditService,
  ) {}

  /** Features of a layer, optionally limited to the map viewport. */
  async list(query: GisFeaturesQuery): Promise<GisFeatureDto[]> {
    await this.layers.requireLayer(query.layerId);
    const conds = [eq(layerFeatures.layerId, query.layerId)];
    if (query.bbox) {
      const [minLon, minLat, maxLon, maxLat] = query.bbox.split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      conds.push(
        sql`${layerFeatures.geom} && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`,
      );
    }

    const rows = await this.db
      .select(this.columns())
      .from(layerFeatures)
      .where(and(...conds))
      .orderBy(desc(layerFeatures.createdAt))
      .limit(query.limit);
    return rows.map((r) => this.toDto(r));
  }

  async getOne(id: string): Promise<GisFeatureDto> {
    return this.toDto(await this.requireFeature(id));
  }

  async create(input: CreateGisFeatureInput, user: AuthUser): Promise<GisFeatureDto> {
    const layer = await this.layers.requireLayer(input.layerId);
    await this.layers.assertAccess(layer, user, 'editor');
    this.assertGeometry(layer.geometryType, input.geometry);

    const [created] = await this.db
      .insert(layerFeatures)
      .values({
        layerId: layer.id,
        geom: this.geomSql(input.geometry),
        props: input.props,
        createdBy: user.id,
      })
      .returning({ id: layerFeatures.id });

    this.audit.log({
      action: 'gis.feature.created',
      actorId: user.id,
      entityType: 'layer_feature',
      entityId: created!.id,
      meta: { layerId: layer.id, geometryType: input.geometry.type },
    });
    return this.getOne(created!.id);
  }

  /** Geometry and/or attributes. The previous geometry goes into the audit trail
   *  so an edit can always be traced back (docs/modules/10 §4). */
  async patch(id: string, input: PatchGisFeatureInput, user: AuthUser): Promise<GisFeatureDto> {
    const existing = await this.requireFeature(id);
    const layer = await this.layers.requireLayer(existing.layerId);
    await this.layers.assertAccess(layer, user, 'editor');
    if (input.geometry) this.assertGeometry(layer.geometryType, input.geometry);

    await this.db
      .update(layerFeatures)
      .set({
        ...(input.geometry ? { geom: this.geomSql(input.geometry) } : {}),
        ...(input.props ? { props: input.props } : {}),
        updatedAt: new Date(),
      })
      .where(eq(layerFeatures.id, id));

    this.audit.log({
      action: 'gis.feature.updated',
      actorId: user.id,
      entityType: 'layer_feature',
      entityId: id,
      meta: {
        layerId: layer.id,
        fields: Object.keys(input),
        // Previous geometry — the history required by §4.
        ...(input.geometry ? { prevGeom: JSON.parse(existing.geojson) as unknown } : {}),
      },
    });
    return this.getOne(id);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const existing = await this.requireFeature(id);
    const layer = await this.layers.requireLayer(existing.layerId);
    await this.layers.assertAccess(layer, user, 'editor');

    await this.db.delete(layerFeatures).where(eq(layerFeatures.id, id));
    this.audit.log({
      action: 'gis.feature.deleted',
      actorId: user.id,
      entityType: 'layer_feature',
      entityId: id,
      meta: { layerId: layer.id, prevGeom: JSON.parse(existing.geojson) as unknown },
    });
  }

  // --- helpers ---

  private assertGeometry(layerType: string | null, geometry: GeoJsonGeometry): void {
    if (!geometryAllowed(layerType, geometry)) {
      throw AppException.badRequest(
        'gis.feature.geometry_mismatch',
        `This layer accepts ${layerType} geometry, got ${geometry.type}`,
        { expected: layerType, actual: geometry.type },
      );
    }
  }

  /** Client GeoJSON → PostGIS 4326. The shape is already zod-validated, so this
   *  can't reach ST_GeomFromGeoJSON as malformed input. */
  private geomSql(geometry: GeoJsonGeometry) {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`;
  }

  private columns() {
    return {
      id: layerFeatures.id,
      layerId: layerFeatures.layerId,
      geojson: sql<string>`ST_AsGeoJSON(${layerFeatures.geom})`.as('geojson'),
      props: layerFeatures.props,
      createdBy: layerFeatures.createdBy,
      createdAt: layerFeatures.createdAt,
      updatedAt: layerFeatures.updatedAt,
    };
  }

  /** A feature of a soft-deleted layer is gone as far as the API is concerned —
   *  the layer's own reads already 404, and the tiles filter it out (0021). */
  private async requireFeature(id: string): Promise<FeatureRow> {
    const [row] = await this.db
      .select(this.columns())
      .from(layerFeatures)
      .innerJoin(gisLayers, eq(gisLayers.id, layerFeatures.layerId))
      .where(and(eq(layerFeatures.id, id), isNull(gisLayers.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('gis.feature.not_found', 'Feature not found');
    return row as FeatureRow;
  }

  private toDto(row: FeatureRow): GisFeatureDto {
    return {
      id: row.id,
      layerId: row.layerId,
      geometry: JSON.parse(row.geojson) as GeoJsonGeometry,
      props: (row.props ?? {}) as Record<string, unknown>,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
