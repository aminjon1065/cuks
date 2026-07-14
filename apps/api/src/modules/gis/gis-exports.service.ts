import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import { gisExports, type Database } from '@cuks/db';
import {
  GEO_JOB_OPTIONS,
  QUEUE,
  type CreateGisExportInput,
  type GeoExportJobData,
  type GisExportDto,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { GisLayersService } from './gis-layers.service';

type GisExport = typeof gisExports.$inferSelect;

/**
 * Geo-export (docs/modules/10 §6; task 2.8). A layer or a selection of incidents
 * is rendered by the `geo-export` worker — the request only records what to render
 * and queues it; the result arrives as a notification with a download link.
 */
@Injectable()
export class GisExportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly layers: GisLayersService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE.geoExport) private readonly queue: Queue<GeoExportJobData>,
  ) {}

  async create(input: CreateGisExportInput, user: AuthUser): Promise<GisExportDto> {
    // A layer export is only offered for a layer that exists — the worker would
    // otherwise fail asynchronously on something the caller could be told now.
    if (input.source === 'layer') {
      await this.layers.requireLayer(input.layerId!);
    }

    const [created] = await this.db
      .insert(gisExports)
      .values({
        source: input.source,
        format: input.format,
        params:
          input.source === 'layer' ? { layerId: input.layerId } : { filters: input.filters ?? {} },
        status: 'pending',
        createdBy: user.id,
      })
      .returning();

    await this.queue.add('export', { exportId: created!.id }, GEO_JOB_OPTIONS);
    this.audit.log({
      action: 'gis.export.queued',
      actorId: user.id,
      entityType: 'gis_export',
      entityId: created!.id,
      meta: { source: input.source, format: input.format },
    });
    return this.toDto(created!);
  }

  async getOne(id: string, user: AuthUser): Promise<GisExportDto> {
    return this.toDto(await this.requireExport(id, user));
  }

  async list(user: AuthUser): Promise<GisExportDto[]> {
    const rows = await this.db
      .select()
      .from(gisExports)
      .where(eq(gisExports.createdBy, user.id))
      .orderBy(desc(gisExports.createdAt))
      .limit(20);
    return rows.map((row) => this.toDto(row));
  }

  /** A short-lived presigned download (the same `attachment` disposition every
   *  other download here uses). */
  async downloadUrl(id: string, user: AuthUser): Promise<string> {
    const record = await this.requireExport(id, user);
    if (record.status !== 'done' || !record.storageKey) {
      throw AppException.conflict('gis.export.not_ready', 'Export is not ready yet');
    }
    return this.storage.getDownloadUrl(record.storageKey, record.fileName ?? `export-${id}`);
  }

  /** An export is the requester's own — it can carry data filtered to what *they*
   *  were allowed to see when they asked for it. */
  private async requireExport(id: string, user: AuthUser): Promise<GisExport> {
    const where = user.isSuperadmin
      ? eq(gisExports.id, id)
      : and(eq(gisExports.id, id), eq(gisExports.createdBy, user.id));
    const [row] = await this.db.select().from(gisExports).where(where).limit(1);
    if (!row) throw AppException.notFound('gis.export.not_found', 'Export not found');
    return row;
  }

  private toDto(row: GisExport): GisExportDto {
    return {
      id: row.id,
      source: row.source,
      format: row.format,
      status: row.status,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      featureCount: row.featureCount,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
