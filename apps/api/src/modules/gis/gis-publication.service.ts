import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { gisLayers, type Database } from '@cuks/db';
import type { GisLayerDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { drawnViewName, publishedSourceName } from './gis-source-name';
import { GeoServerService } from './geoserver.service';
import { GisLayersService } from './gis-layers.service';

type GisLayer = typeof gisLayers.$inferSelect;

/**
 * WMS/WFS publication of registry layers to GeoServer (docs/modules/10 §7, task
 * 2.9). What is published is a table in schema `gis`:
 *  - an `imported` layer already is one (`table_name`);
 *  - a `drawn` layer shares `gis.layer_features`, so a thin, updatable view
 *    `gis.v_<slug>` narrows it to that layer's features (WFS-T stays possible for
 *    editors), and GeoServer publishes the view.
 *
 * Toggling `is_published_wms` is the single source of truth; it and the GeoServer
 * side are kept in step, and a GeoServer failure rolls the flag back so the two
 * never disagree silently.
 */
@Injectable()
export class GisPublicationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly layers: GisLayersService,
    private readonly geoserver: GeoServerService,
    private readonly audit: AuditService,
  ) {}

  async publish(id: string, user: AuthUser): Promise<GisLayerDto> {
    const layer = await this.layers.requireLayer(id);
    await this.layers.assertManage(layer, user);
    if (!this.geoserver.configured) {
      throw AppException.badRequest(
        'gis.geoserver.not_configured',
        'GeoServer is not configured on this server',
      );
    }

    const table = await this.ensureSourceTable(layer);
    const geoserverLayer = await this.geoserver.publish(table);

    const [updated] = await this.db
      .update(gisLayers)
      .set({ isPublishedWms: true, geoserverLayer, updatedAt: new Date() })
      .where(eq(gisLayers.id, id))
      .returning();

    this.audit.log({
      action: 'gis.layer.published',
      actorId: user.id,
      entityType: 'layer',
      entityId: id,
      meta: { geoserverLayer },
    });
    return this.layers.toPublicDto(updated!, user);
  }

  async unpublish(id: string, user: AuthUser): Promise<GisLayerDto> {
    const layer = await this.layers.requireLayer(id);
    await this.layers.assertManage(layer, user);

    if (this.geoserver.configured) {
      const table = this.sourceTableName(layer);
      if (table) await this.geoserver.unpublish(table);
    }
    if (layer.kind === 'drawn') await this.dropView(layer);

    const [updated] = await this.db
      .update(gisLayers)
      .set({ isPublishedWms: false, geoserverLayer: null, updatedAt: new Date() })
      .where(eq(gisLayers.id, id))
      .returning();

    this.audit.log({
      action: 'gis.layer.unpublished',
      actorId: user.id,
      entityType: 'layer',
      entityId: id,
    });
    return this.layers.toPublicDto(updated!, user);
  }

  // --- source table resolution ---

  /** The `gis` table/view GeoServer publishes for this layer, creating the drawn
   *  layer's view if needed. */
  private async ensureSourceTable(layer: GisLayer): Promise<string> {
    if (layer.kind === 'imported') {
      if (!layer.tableName) {
        throw AppException.badRequest('gis.layer.no_table', 'Imported layer has no table');
      }
      return layer.tableName;
    }
    if (layer.kind === 'drawn') {
      const view = drawnViewName(layer);
      // Drizzle turns `${}` into a bind parameter, but PostgreSQL forbids parameters
      // in a stored view body or a column DEFAULT (both are parsed once and kept), so
      // the layer id — server-owned and format-checked here — is inlined as a literal.
      const idLiteral = sql.raw(`'${assertUuid(layer.id)}'::uuid`);
      // A single-table WHERE view is auto-updatable, so WFS-T works for editors; the
      // CASCADED CHECK OPTION confines every inserted/updated row to this one layer.
      await this.db.execute(sql`
        CREATE OR REPLACE VIEW gis.${sql.identifier(view)} AS
        SELECT id, layer_id, geom, props, created_at, updated_at
        FROM gis.layer_features
        WHERE layer_id = ${idLiteral}
        WITH CASCADED CHECK OPTION
      `);
      // Column DEFAULTs let a direct WFS-T INSERT succeed: a QGIS/ArcGIS client supplies
      // neither the platform's UUIDv7 `id` nor `layer_id`, so `id` gets a fresh UUID and
      // `layer_id` pins to this layer — both NOT NULL columns that would otherwise fail.
      await this.db.execute(sql`
        ALTER VIEW gis.${sql.identifier(view)} ALTER COLUMN id SET DEFAULT gen_random_uuid()
      `);
      await this.db.execute(sql`
        ALTER VIEW gis.${sql.identifier(view)} ALTER COLUMN layer_id SET DEFAULT ${idLiteral}
      `);
      return view;
    }
    throw AppException.badRequest(
      'gis.layer.not_publishable',
      'Only imported and drawn layers can be published',
    );
  }

  /** The published source name without creating anything (for unpublish). */
  private sourceTableName(layer: GisLayer): string | null {
    return publishedSourceName(layer);
  }

  private async dropView(layer: GisLayer): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS gis.${sql.identifier(drawnViewName(layer))}`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A layer id always comes from the DB, but before it is inlined into raw DDL it is
 *  checked to be a plain UUID so nothing else can ever reach the SQL string. */
function assertUuid(value: string): string {
  if (!UUID_RE.test(value)) {
    throw AppException.badRequest('gis.layer.bad_id', 'Layer id is not a valid UUID');
  }
  return value;
}
