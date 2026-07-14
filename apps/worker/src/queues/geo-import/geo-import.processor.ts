import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import {
  auditLog,
  gisImports,
  gisLayers,
  notifications,
  resourceAcl,
  type Database,
} from '@cuks/db';
import {
  GIS_IMPORT_MAX_FEATURES,
  QUEUE,
  slugify,
  type GeoImportJobData,
  type GisImportPreview,
} from '@cuks/shared';
import { DB } from '../../common/db.module';
import { StorageService } from '../../common/storage.service';
import { openSource, type OpenedSource } from './geo-source';

/** Rows per INSERT. Big enough to be fast, small enough that isolating a bad row
 *  by re-running the batch one row at a time stays cheap. */
const BATCH_SIZE = 500;
/** The per-row error log is for a human to read, not an archive of every failure. */
const MAX_LOG_LINES = 200;

interface PendingRow {
  /** 1-based index in the source file — what the log line refers to. */
  index: number;
  wkbHex: string;
  values: unknown[];
}

/**
 * `geo-import` queue consumer (docs/modules/10 §6; task 2.8). Reads the uploaded
 * file with GDAL/OGR — the engine behind ogr2ogr — into its own physical table
 * `gis.l_<slug>`, reprojected to 4326 and with invalid geometries repaired, then
 * registers it as an `imported` layer with an auto style.
 *
 * Two things the CLI could not give us and the spec asks for: a *per-row* error log
 * (§6 «Ошибки — построчный лог»), and no database credentials in a child process's
 * argv. Rows are inserted in batches; a batch that fails is replayed one row at a
 * time, so one bad geometry costs its own line in the log instead of the import.
 */
@Processor(QUEUE.geoImport)
export class GeoImportProcessor extends WorkerHost {
  private readonly logger = new Logger(GeoImportProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {
    super();
  }

  /**
   * The job is not retried (a retry would import the same features twice), so a
   * crash or a stall would otherwise leave the record at `processing` forever and
   * the wizard polling it. BullMQ reports the failure here; the record follows.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<GeoImportJobData>, error: Error): Promise<void> {
    const [record] = await this.db
      .select({ status: gisImports.status, createdBy: gisImports.createdBy })
      .from(gisImports)
      .where(eq(gisImports.id, job.data.importId))
      .limit(1);
    if (!record || record.status === 'done' || record.status === 'failed') return;
    await this.fail(
      job.data.importId,
      record.createdBy,
      `Импорт прерван: ${error?.message ?? 'задача не завершилась'}`,
    );
  }

  async process(job: Job<GeoImportJobData>): Promise<void> {
    const { importId } = job.data;
    const [record] = await this.db
      .select()
      .from(gisImports)
      .where(eq(gisImports.id, importId))
      .limit(1);
    if (!record) {
      this.logger.warn(`import ${importId} is gone — nothing to do`);
      return;
    }
    if (!record.storageKey) {
      await this.fail(importId, record.createdBy, 'Файл импорта не найден в хранилище');
      return;
    }

    await this.db
      .update(gisImports)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(gisImports.id, importId));

    const dir = await mkdtemp(join(tmpdir(), 'cuks-geo-import-'));
    const log: string[] = [];
    let source: OpenedSource | null = null;
    // The physical table is created before the layer is registered; if anything
    // between the two throws, this drops the half-built table so a failed import
    // leaves nothing behind (there is no registry row that would ever reference it).
    let createdTable: string | null = null;
    try {
      const bytes = await this.storage.getObject(record.storageKey);
      const localPath = join(dir, record.sourceName ?? 'source');
      await writeFile(localPath, bytes);

      source = openSource(localPath);
      log.push(
        `Драйвер: ${source.driver}; слой: ${source.layerName}; геометрия: ${source.geometryType}`,
      );
      if (!source.transform) {
        log.push('Система координат не указана — данные считаны как WGS84 (EPSG:4326)');
      }

      const total = source.layer.features.count(true);
      if (total > GIS_IMPORT_MAX_FEATURES) {
        throw new Error(
          `В файле ${total} объектов — больше допустимых ${GIS_IMPORT_MAX_FEATURES}. ` +
            'Загрузите слой напрямую в PostGIS (docs/modules/10 §7).',
        );
      }

      const title =
        (record.options as { title?: string } | null)?.title ??
        stripExtension(record.sourceName ?? 'Импортированный слой');
      const table = await this.uniqueTableName(slugify(title));

      await this.createTable(table, source);
      createdTable = table;
      const { imported, skipped } = await this.copyFeatures(table, source, log);
      await this.finalizeTable(table, source.geometryType);

      const extent = await this.extentOf(table);
      const preview: GisImportPreview = {
        sourceLayer: source.layerName,
        driver: source.driver,
        geometryType: source.geometryType,
        featureCount: imported,
        skippedCount: skipped,
        fields: source.fields.map((f) => ({ name: f.name, type: f.type })),
        extent,
      };

      const layerId = await this.registerLayer(
        table,
        title,
        source.geometryType,
        record.createdBy,
        extent,
      );
      // The table now has a registry row; the failure cleanup must not drop it.
      createdTable = null;
      log.push(`Импортировано объектов: ${imported}${skipped ? `, пропущено: ${skipped}` : ''}`);

      await this.db
        .update(gisImports)
        .set({
          status: 'done',
          layerId,
          preview,
          log: log.join('\n'),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(gisImports.id, importId));

      await this.notify(record.createdBy, {
        type: 'gis.import.done',
        title: 'Импорт слоя завершён',
        body: `Слой «${title}»: ${imported} объектов${skipped ? `, пропущено ${skipped}` : ''}`,
        entityId: layerId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`import ${importId} failed: ${message}`);
      log.push(`Ошибка импорта: ${message}`);
      if (createdTable) await this.dropTable(createdTable);
      await this.fail(importId, record.createdBy, log.join('\n'));
    } finally {
      source?.dataset.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  // --- table creation and loading ---

  /** `gis.l_<slug>`, suffixed if a table with that name already exists (a re-import
   *  of the same file must not silently append to the previous one). */
  private async uniqueTableName(slug: string): Promise<string> {
    const base = `l_${slug.replace(/-/g, '_')}`.slice(0, 55);
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? base : `${base}_${i + 1}`;
      const rows = await this.db.execute<{ exists: boolean }>(
        sql`SELECT to_regclass(${`gis.${candidate}`}) IS NOT NULL AS exists`,
      );
      if (!rows.rows[0]?.exists) return candidate;
    }
    throw new Error('Не удалось подобрать имя таблицы для слоя');
  }

  private async createTable(table: string, source: OpenedSource): Promise<void> {
    const columns = source.fields.map((f) => sql`${sql.identifier(f.name)} ${sql.raw(f.type)}`);
    await this.db.execute(sql`
      CREATE TABLE gis.${sql.identifier(table)} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        geom geometry(${sql.raw(source.geometryType)}, 4326)
        ${columns.length ? sql`, ${sql.join(columns, sql`, `)}` : sql``}
      )
    `);
  }

  /** Drop a half-built import table (a failure before the registry row exists). */
  private async dropTable(table: string): Promise<void> {
    try {
      await this.db.execute(sql`DROP TABLE IF EXISTS gis.${sql.identifier(table)}`);
    } catch (error) {
      this.logger.warn(`could not drop orphaned table gis.${table}: ${String(error)}`);
    }
  }

  /** GIS clients and Martin both need the spatial index; the planner needs the stats. */
  private async finalizeTable(table: string, _geometryType: string): Promise<void> {
    await this.db.execute(
      sql`CREATE INDEX ${sql.identifier(`${table}_geom_idx`)} ON gis.${sql.identifier(table)} USING GIST (geom)`,
    );
    await this.db.execute(sql`ANALYZE gis.${sql.identifier(table)}`);
  }

  /**
   * Read the source feature by feature and insert in batches. A batch that fails is
   * replayed row by row so the offending feature — and only it — is dropped, with
   * its source row number in the log.
   */
  private async copyFeatures(
    table: string,
    source: OpenedSource,
    log: string[],
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    let index = 0;
    let batch: PendingRow[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      try {
        const inserted = await this.insertRows(table, source, rows);
        imported += inserted;
        // A geometry that repaired to empty (ST_MakeValid + ST_CollectionExtract can
        // yield nothing) is filtered by the insert — count it skipped, not imported.
        const empty = rows.length - inserted;
        if (empty > 0) {
          skipped += empty;
          appendLog(log, `пропущено объектов с пустой геометрией: ${empty}`);
        }
      } catch {
        // Isolate the bad row(s): everything else in the batch is still importable.
        for (const row of rows) {
          try {
            const inserted = await this.insertRows(table, source, [row]);
            if (inserted > 0) {
              imported += 1;
            } else {
              skipped += 1;
              appendLog(log, `строка ${row.index}: пустая геометрия после исправления`);
            }
          } catch (error) {
            skipped += 1;
            appendLog(
              log,
              `строка ${row.index}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    };

    // Streamed, not collected: a 200k-feature source would not fit in memory as
    // hex-encoded WKB.
    for (
      let feature = source.layer.features.first();
      feature;
      feature = source.layer.features.next()
    ) {
      index += 1;
      try {
        const geometry = feature.getGeometry();
        if (!geometry) {
          skipped += 1;
          appendLog(log, `строка ${index}: нет геометрии`);
          continue;
        }
        if (source.transform) geometry.transform(source.transform);
        const wkbHex = geometry.toWKB().toString('hex');
        const values = source.fields.map((field) =>
          normalize(feature.fields.get(field.sourceName)),
        );
        batch.push({ index, wkbHex, values });
      } catch (error) {
        skipped += 1;
        appendLog(
          log,
          `строка ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    return { imported, skipped };
  }

  /** Insert a batch, dropping rows whose geometry repaired to empty, and return how
   *  many actually landed (so the caller can count the empties as skipped). */
  private async insertRows(
    table: string,
    source: OpenedSource,
    rows: PendingRow[],
  ): Promise<number> {
    const columns = ['geom', ...source.fields.map((field) => field.name)].map(
      (name) => sql`${sql.identifier(name)}`,
    );
    const tuples = rows.map(
      (row) =>
        sql`(${this.geomExpression(source.geometryType, row.wkbHex)}${
          row.values.length
            ? sql`, ${sql.join(
                row.values.map((value) => sql`${value}`),
                sql`, `,
              )}`
            : sql``
        })`,
    );
    // A bound parameter inside VALUES defaults to text, so `SELECT … FROM (VALUES …)`
    // would feed text into a bigint/double column; each attribute is cast back to
    // its declared column type (the direct INSERT … VALUES coerces implicitly, but
    // that form cannot filter empty geometries). geom is already geometry-typed.
    const select = [
      sql`v.geom`,
      ...source.fields.map((field) => sql`v.${sql.identifier(field.name)}::${sql.raw(field.type)}`),
    ];
    const result = await this.db.execute(sql`
      INSERT INTO gis.${sql.identifier(table)} (${sql.join(columns, sql`, `)})
      SELECT ${sql.join(select, sql`, `)}
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v (${sql.join(columns, sql`, `)})
      WHERE v.geom IS NOT NULL AND NOT ST_IsEmpty(v.geom)
    `);
    return result.rowCount ?? 0;
  }

  /**
   * WKB → the column's geometry type. Invalid polygons/lines (self-intersections
   * are the norm in official shapefiles) are repaired with ST_MakeValid, which can
   * hand back a collection — ST_CollectionExtract then keeps only the parts the
   * column accepts, and ST_Multi normalizes single parts into the Multi- form.
   */
  private geomExpression(geometryType: string, wkbHex: string) {
    const raw = sql`ST_GeomFromWKB(decode(${wkbHex}, 'hex'), 4326)`;
    switch (geometryType) {
      case 'Point':
        return raw;
      case 'MultiPoint':
        return sql`ST_Multi(${raw})`;
      case 'MultiLineString':
        return sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(${raw}), 2))`;
      case 'MultiPolygon':
        return sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(${raw}), 3))`;
      default:
        return sql`ST_MakeValid(${raw})`;
    }
  }

  private async extentOf(table: string): Promise<GisImportPreview['extent']> {
    const result = await this.db.execute<{
      west: number | null;
      south: number | null;
      east: number | null;
      north: number | null;
    }>(sql`
      SELECT ST_XMin(e) AS west, ST_YMin(e) AS south, ST_XMax(e) AS east, ST_YMax(e) AS north
      FROM (SELECT ST_Extent(geom) AS e FROM gis.${sql.identifier(table)}) AS x
    `);
    const row = result.rows[0];
    if (
      !row ||
      row.west === null ||
      row.south === null ||
      row.east === null ||
      row.north === null
    ) {
      return null;
    }
    return [Number(row.west), Number(row.south), Number(row.east), Number(row.north)];
  }

  // --- registry ---

  /** The imported layer joins the registry with a style derived from its geometry,
   *  and its importer manages it (same rule as a drawn layer, task 2.7). The extent
   *  is kept in the style so the map can zoom-to-layer — an imported layer has no
   *  features endpoint of its own, and its tiles come from the shared function
   *  source, which carries no per-layer bounds. */
  private async registerLayer(
    table: string,
    title: string,
    geometryType: string,
    userId: string | null,
    extent: GisImportPreview['extent'],
  ): Promise<string> {
    const slug = await this.uniqueSlug(slugify(title));
    const [layer] = await this.db
      .insert(gisLayers)
      .values({
        slug,
        title,
        kind: 'imported',
        geometryType,
        tableName: table,
        style: { ...autoStyle(geometryType), ...(extent ? { extent } : {}) },
        createdBy: userId,
      })
      .returning({ id: gisLayers.id });

    if (userId) {
      await this.db
        .insert(resourceAcl)
        .values({
          resourceType: 'layer',
          resourceId: layer!.id,
          subjectType: 'user',
          subjectId: userId,
          level: 'manager',
          createdBy: userId,
        })
        .onConflictDoNothing();
    }

    // Same audit event the API writes for a drawn layer (gis.layer.created), so an
    // imported layer has the same provenance trail.
    await this.db.insert(auditLog).values({
      action: 'gis.layer.created',
      actorId: userId,
      entityType: 'layer',
      entityId: layer!.id,
      meta: { slug, kind: 'imported', geometryType, tableName: table },
    });
    return layer!.id;
  }

  private async uniqueSlug(base: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const rows = await this.db.execute<{ taken: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM gis.layers WHERE slug = ${candidate} AND deleted_at IS NULL
        ) AS taken
      `);
      if (!rows.rows[0]?.taken) return candidate;
    }
    throw new Error('Не удалось подобрать slug для слоя');
  }

  // --- outcome ---

  private async fail(importId: string, userId: string | null, log: string): Promise<void> {
    await this.db
      .update(gisImports)
      .set({ status: 'failed', log, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(gisImports.id, importId));
    await this.notify(userId, {
      type: 'gis.import.failed',
      title: 'Импорт слоя не выполнен',
      body: log.split('\n').slice(-1)[0] ?? 'Ошибка импорта',
      entityId: importId,
    });
  }

  /** In-app only: the worker has no Socket.IO server (it lives in apps/api), so the
   *  notification surfaces on the recipient's next fetch — same as `av-scan` (1.3). */
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
      entityType: 'gis_import',
      entityId: input.entityId,
    });
  }
}

function appendLog(log: string[], line: string): void {
  if (log.length < MAX_LOG_LINES) log.push(line);
  else if (log.length === MAX_LOG_LINES) log.push('… остальные ошибки не показаны');
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Values arrive from OGR as strings, numbers, dates or null. */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

/** Auto style by geometry (docs/modules/10 §6: «автостиль по типу геометрии»). */
function autoStyle(geometryType: string): Record<string, unknown> {
  switch (geometryType) {
    case 'Point':
    case 'MultiPoint':
      return { color: '#1256a0', kind: 'circle' };
    case 'MultiLineString':
      return { color: '#b45309', kind: 'line' };
    case 'MultiPolygon':
      return { color: '#7c3aed', kind: 'fill' };
    default:
      return { color: '#15803d', kind: 'mixed' };
  }
}
