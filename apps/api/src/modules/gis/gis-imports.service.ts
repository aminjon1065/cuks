import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import { gisImports, type Database } from '@cuks/db';
import {
  GEO_JOB_OPTIONS,
  GIS_IMPORT_MAX_BYTES,
  QUEUE,
  type CreateGisImportInput,
  type CreateGisImportResponse,
  type GeoImportJobData,
  type GisImportDto,
  type GisImportPreview,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../common/storage/storage.service';

type GisImport = typeof gisImports.$inferSelect;

/** Extensions the geo-import understands (docs/modules/10 §6). A shapefile is a
 *  set of sidecar files, so it arrives zipped. */
const ACCEPTED_EXTENSIONS = ['.geojson', '.json', '.zip', '.kml', '.gpkg', '.csv'] as const;

/** Content type for the presigned PUT. The worker sniffs the real format from the
 *  bytes, so this only has to be something S3 accepts. */
const UPLOAD_CONTENT_TYPE = 'application/octet-stream';

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

/**
 * Geo-import wizard (docs/modules/10 §6; task 2.8). Three steps, mirroring how
 * every other upload works here: reserve a record and hand out a presigned PUT →
 * the browser uploads straight to storage → the record is queued and the worker
 * does the reading (`geo-import`). The API never streams the file itself.
 */
@Injectable()
export class GisImportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE.geoImport) private readonly queue: Queue<GeoImportJobData>,
  ) {}

  /** Step 1 — the record exists before the bytes do, so an abandoned upload is a
   *  `pending` row we can clean up rather than an orphaned object. */
  async create(input: CreateGisImportInput, user: AuthUser): Promise<CreateGisImportResponse> {
    const extension = extensionOf(input.fileName);
    if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
      throw AppException.badRequest(
        'gis.import.unsupported_format',
        `Unsupported format "${extension}" — expected one of ${ACCEPTED_EXTENSIONS.join(', ')}`,
        { accepted: ACCEPTED_EXTENSIONS },
      );
    }

    const [created] = await this.db
      .insert(gisImports)
      .values({
        status: 'pending',
        sourceName: input.fileName,
        sizeBytes: input.size,
        options: input.title ? { title: input.title } : {},
        createdBy: user.id,
      })
      .returning();

    const storageKey = `gis-imports/${created!.id}/${sanitize(input.fileName)}`;
    await this.db
      .update(gisImports)
      .set({ storageKey, updatedAt: new Date() })
      .where(eq(gisImports.id, created!.id));

    const uploadUrl = await this.storage.getUploadUrl(storageKey, UPLOAD_CONTENT_TYPE);
    return { importId: created!.id, uploadUrl };
  }

  /**
   * Step 2 — the browser reports the upload landed. The object is checked before
   * the job is queued (a client could call this without uploading anything), and
   * its real size wins over the declared one.
   */
  async start(id: string, user: AuthUser): Promise<GisImportDto> {
    const record = await this.requireImport(id, user);
    if (record.status !== 'pending') {
      throw AppException.conflict('gis.import.already_started', 'Import is already running');
    }
    if (!record.storageKey) {
      throw AppException.badRequest('gis.import.no_source', 'Import has no uploaded source');
    }

    const size = await this.storage.objectSize(record.storageKey);
    if (size === null) {
      throw AppException.badRequest('gis.import.not_uploaded', 'Source file was not uploaded');
    }
    if (size > GIS_IMPORT_MAX_BYTES) {
      throw AppException.badRequest('gis.import.too_large', 'Source file is too large', {
        maxBytes: GIS_IMPORT_MAX_BYTES,
        size,
      });
    }

    const [updated] = await this.db
      .update(gisImports)
      .set({ sizeBytes: size, updatedAt: new Date() })
      .where(eq(gisImports.id, id))
      .returning();

    await this.queue.add('import', { importId: id }, GEO_JOB_OPTIONS);
    this.audit.log({
      action: 'gis.import.queued',
      actorId: user.id,
      entityType: 'gis_import',
      entityId: id,
      meta: { sourceName: record.sourceName, sizeBytes: size },
    });
    return this.toDto(updated!);
  }

  async getOne(id: string, user: AuthUser): Promise<GisImportDto> {
    return this.toDto(await this.requireImport(id, user));
  }

  /** The caller's own imports, newest first (the wizard's history). */
  async list(user: AuthUser): Promise<GisImportDto[]> {
    const rows = await this.db
      .select()
      .from(gisImports)
      .where(eq(gisImports.createdBy, user.id))
      .orderBy(desc(gisImports.createdAt))
      .limit(20);
    return rows.map((row) => this.toDto(row));
  }

  /** An import belongs to the person who started it; `gis.import` alone does not
   *  open someone else's log (it can carry the contents of their file). */
  private async requireImport(id: string, user: AuthUser): Promise<GisImport> {
    const where = user.isSuperadmin
      ? eq(gisImports.id, id)
      : and(eq(gisImports.id, id), eq(gisImports.createdBy, user.id));
    const [row] = await this.db.select().from(gisImports).where(where).limit(1);
    if (!row) throw AppException.notFound('gis.import.not_found', 'Import not found');
    return row;
  }

  private toDto(row: GisImport): GisImportDto {
    return {
      id: row.id,
      status: row.status,
      sourceName: row.sourceName,
      sizeBytes: row.sizeBytes,
      layerId: row.layerId,
      preview: (row.preview as GisImportPreview | null) ?? null,
      log: row.log,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}

/** Keep the object key printable and path-safe; the original name is kept in the
 *  record, so nothing is lost by flattening it here. */
function sanitize(fileName: string): string {
  return fileName.replace(/[^\w.-]+/g, '_').slice(-120);
}
