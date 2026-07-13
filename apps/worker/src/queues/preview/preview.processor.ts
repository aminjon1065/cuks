import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import { fileVersions, type Database } from '@cuks/db';
import { JOB_PARSE_TIMEOUT_MS, PREVIEW_SIZES, QUEUE, type FileVersionJobData } from '@cuks/shared';
import { previewObjectKey } from '@cuks/shared';
import { DB } from '../../common/db.module';
import { StorageService } from '../../common/storage.service';
import { withTimeout } from '../../common/with-timeout';

const PREVIEW_CONTENT_TYPE = 'image/webp';

/**
 * `preview` queue consumer (docs/modules/12 §5: "sharp-превью 3 размеров").
 * Re-encodes to webp regardless of source format — also strips EXIF/metadata by
 * construction, since sharp only keeps it when `.withMetadata()` is explicitly
 * called (docs/09 §2: "перекодирование sharp (EXIF-очистка)"). Only ever
 * *enqueued* on a `clean` av-scan verdict, but re-checks `avStatus` itself
 * (defense-in-depth, docs/plan/STATUS.md 1.3 decision) rather than trusting
 * caller discipline — a future producer bypassing av-scan would otherwise run
 * sharp over unscanned/infected bytes with nothing to stop it.
 */
@Processor(QUEUE.preview)
export class PreviewProcessor extends WorkerHost {
  private readonly logger = new Logger(PreviewProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<FileVersionJobData>): Promise<void> {
    const { versionId, storageKey } = job.data;

    const [version] = await this.db
      .select({ avStatus: fileVersions.avStatus })
      .from(fileVersions)
      .where(eq(fileVersions.id, versionId))
      .limit(1);
    if (version?.avStatus !== 'clean') {
      this.logger.warn(
        { versionId, avStatus: version?.avStatus },
        'skipping preview: not a clean-verdict version',
      );
      return;
    }

    const bytes = await this.storage.getObject(storageKey);

    for (const [name, edge] of Object.entries(PREVIEW_SIZES)) {
      const resized = await withTimeout(
        sharp(bytes)
          .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
          .webp()
          .toBuffer(),
        JOB_PARSE_TIMEOUT_MS,
        `sharp resize timed out after ${JOB_PARSE_TIMEOUT_MS}ms`,
      );
      await this.storage.putObject(
        previewObjectKey(versionId, name),
        resized,
        PREVIEW_CONTENT_TYPE,
      );
    }
    this.logger.log({ versionId, sizes: Object.keys(PREVIEW_SIZES) }, 'previews generated');
  }
}
