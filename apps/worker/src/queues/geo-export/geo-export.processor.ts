import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { gisExports, gisLayers, notifications, type Database } from '@cuks/db';
import {
  QUEUE,
  type GeoExportJobData,
  type GisExportFormat,
  type IncidentRegistryFilters,
} from '@cuks/shared';
import { DB } from '../../common/db.module';
import { StorageService } from '../../common/storage.service';
import { contentTypeOf, exportFileName, writeExport, type ExportFeature } from './geo-writers';
import { incidentExportConditions } from './incident-filter';

/** An export is a download, not a data dump: a request for the whole incident
 *  registry stops here rather than building a gigabyte in memory. */
const MAX_EXPORT_FEATURES = 100_000;

/**
 * `geo-export` queue consumer (docs/modules/10 §6; task 2.8). Renders a registry
 * layer or a selection of incidents into one of the export formats, puts it in
 * storage and tells the requester it is ready. The download link is presigned by
 * the api on demand (`GET /gis/exports/:id/download`) — the object itself is never
 * public.
 */
@Processor(QUEUE.geoExport)
export class GeoExportProcessor extends WorkerHost {
  private readonly logger = new Logger(GeoExportProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {
    super();
  }

  /** A crashed or stalled job would otherwise leave the record at `processing`
   *  forever, with the dialog polling it (the job is not retried). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<GeoExportJobData>, error: Error): Promise<void> {
    const [record] = await this.db
      .select({ status: gisExports.status, createdBy: gisExports.createdBy })
      .from(gisExports)
      .where(eq(gisExports.id, job.data.exportId))
      .limit(1);
    if (!record || record.status === 'done' || record.status === 'failed') return;
    const message = `Экспорт прерван: ${error?.message ?? 'задача не завершилась'}`;
    await this.db
      .update(gisExports)
      .set({ status: 'failed', error: message, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(gisExports.id, job.data.exportId));
    await this.notify(record.createdBy, {
      type: 'gis.export.failed',
      title: 'Экспорт не выполнен',
      body: message,
      entityId: job.data.exportId,
    });
  }

  async process(job: Job<GeoExportJobData>): Promise<void> {
    const { exportId } = job.data;
    const [record] = await this.db
      .select()
      .from(gisExports)
      .where(eq(gisExports.id, exportId))
      .limit(1);
    if (!record) {
      this.logger.warn(`export ${exportId} is gone — nothing to do`);
      return;
    }

    await this.db
      .update(gisExports)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(gisExports.id, exportId));

    try {
      const params = (record.params ?? {}) as {
        layerId?: string;
        filters?: IncidentRegistryFilters;
      };
      const { features, name } =
        record.source === 'layer'
          ? await this.readLayer(params.layerId!)
          : await this.readIncidents(params.filters ?? {});

      if (features.length > MAX_EXPORT_FEATURES) {
        throw new Error(
          `Выборка содержит ${features.length} объектов — больше допустимых ${MAX_EXPORT_FEATURES}. Уточните фильтры.`,
        );
      }

      const format = record.format as GisExportFormat;
      const body = await writeExport(features, format, name);
      const fileName = exportFileName(name, format);
      const storageKey = `gis-exports/${exportId}/${fileName.replace(/[^\w.-]+/g, '_')}`;
      await this.storage.putObject(storageKey, body, contentTypeOf(format));

      await this.db
        .update(gisExports)
        .set({
          status: 'done',
          storageKey,
          fileName,
          sizeBytes: body.length,
          featureCount: features.length,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(gisExports.id, exportId));

      await this.notify(record.createdBy, {
        type: 'gis.export.done',
        title: 'Экспорт готов',
        body: `«${fileName}» — ${features.length} объектов. Файл доступен для скачивания.`,
        entityId: exportId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`export ${exportId} failed: ${message}`);
      await this.db
        .update(gisExports)
        .set({
          status: 'failed',
          error: message,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(gisExports.id, exportId));
      await this.notify(record.createdBy, {
        type: 'gis.export.failed',
        title: 'Экспорт не выполнен',
        body: message,
        entityId: exportId,
      });
    }
  }

  // --- sources ---

  /** A registry layer: drawn features live in the shared table, imported ones in
   *  their own (`table_name`, resolved from the registry — never from the client). */
  private async readLayer(layerId: string): Promise<{ features: ExportFeature[]; name: string }> {
    const [layer] = await this.db
      .select()
      .from(gisLayers)
      .where(eq(gisLayers.id, layerId))
      .limit(1);
    if (!layer || layer.deletedAt) throw new Error('Слой не найден');

    if (layer.kind === 'drawn') {
      const rows = await this.db.execute<{ geometry: string; props: unknown }>(sql`
        SELECT ST_AsGeoJSON(geom) AS geometry, props
        FROM gis.layer_features
        WHERE layer_id = ${layerId}
        ORDER BY created_at
      `);
      return {
        name: layer.title,
        features: rows.rows.map((row) => ({
          geometry: JSON.parse(row.geometry) as unknown,
          props: (row.props ?? {}) as Record<string, unknown>,
        })),
      };
    }

    if (layer.kind === 'imported' && layer.tableName) {
      const rows = await this.db.execute<Record<string, unknown>>(sql`
        SELECT ST_AsGeoJSON(geom) AS __geometry, t.*
        FROM gis.${sql.identifier(layer.tableName)} t
      `);
      return {
        name: layer.title,
        features: rows.rows.map((row) => {
          const { __geometry: geometry, geom: _geom, ...props } = row;
          return {
            geometry: typeof geometry === 'string' ? (JSON.parse(geometry) as unknown) : null,
            props,
          };
        }),
      };
    }

    throw new Error('Экспорт этого типа слоя не поддерживается');
  }

  /**
   * The incident selection, filtered exactly as the registry filters it (2.5).
   * Every operator here must match `IncidentsService.whereFor`, so that exporting
   * the on-screen selection gives the same rows the registry (and its XLSX export)
   * shows — severity is an exact level, not a threshold, and the search is the same
   * substring ILIKE over number/description/address, not full-text.
   */
  private async readIncidents(
    filters: IncidentRegistryFilters,
  ): Promise<{ features: ExportFeature[]; name: string }> {
    const conditions = incidentExportConditions(filters);

    const rows = await this.db.execute<{
      geometry: string | null;
      number: string;
      type_code: string;
      severity: number;
      status: string;
      occurred_at: Date;
      address_text: string | null;
      description: string | null;
      dead: number;
      injured: number;
      evacuated: number;
      affected: number;
      damage_est: string | null;
    }>(sql`
      SELECT
        ST_AsGeoJSON(i.geom) AS geometry,
        i.number, i.type_code, i.severity, i.status, i.occurred_at,
        i.address_text, i.description,
        i.dead, i.injured, i.evacuated, i.affected, i.damage_est
      FROM app.incidents i
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY i.occurred_at DESC
    `);

    return {
      name: 'ЧС',
      features: rows.rows.map((row) => ({
        geometry: row.geometry ? (JSON.parse(row.geometry) as unknown) : null,
        props: {
          number: row.number,
          type_code: row.type_code,
          severity: row.severity,
          status: row.status,
          occurred_at:
            row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
          address: row.address_text ?? '',
          description: row.description ?? '',
          dead: row.dead,
          injured: row.injured,
          evacuated: row.evacuated,
          affected: row.affected,
          damage_est: row.damage_est ?? '',
        },
      })),
    };
  }

  /** In-app only — the worker has no Socket.IO server (apps/api owns it), so this
   *  surfaces on the recipient's next fetch, exactly like `av-scan` (1.3). */
  private async notify(
    userId: string | null,
    input: { type: string; title: string; body: string; entityId: string },
  ): Promise<void> {
    if (!userId) return;
    await this.db.insert(notifications).values({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: 'gis_export',
      entityId: input.entityId,
    });
  }
}
