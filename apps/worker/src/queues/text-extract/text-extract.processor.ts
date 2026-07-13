import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { fileVersions, type Database } from '@cuks/db';
import {
  DOCX_MIME_TYPE,
  JOB_PARSE_TIMEOUT_MS,
  MAX_EXTRACTED_TEXT_LENGTH,
  PDF_MIME_TYPE,
  QUEUE,
  type FileVersionJobData,
} from '@cuks/shared';
import { truncateSafe } from '@cuks/shared';
import { DB } from '../../common/db.module';
import { StorageService } from '../../common/storage.service';
import { withTimeout } from '../../common/with-timeout';

// Postgres text columns reject embedded NUL bytes outright ("invalid byte
// sequence for encoding UTF8: 0x00") -- a known failure mode of lenient PDF/
// DOCX decoders on malformed content streams. Strip NUL and other C0 control
// characters (keep tab/newline/CR) before the column ever sees the extracted
// text. Built from char codes, not literal escapes, so control bytes in the
// source can't get mangled by editor/tooling round-tripping.
const CONTROL_CHAR_CODES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30, 31,
];
const CONTROL_CHARS_PATTERN = new RegExp(
  '[' + CONTROL_CHAR_CODES.map((c) => String.fromCharCode(c)).join('') + ']',
  'g',
);

/**
 * `text-extract` queue consumer (docs/modules/12 §5/§8: "pdf-parse, mammoth").
 * Populates `file_versions.extracted_text` for later FTS (search itself is a
 * later task — this just fills the column). Only ever *enqueued* on a `clean`
 * av-scan verdict, but re-checks `avStatus` itself (defense-in-depth,
 * docs/plan/STATUS.md 1.3 decision) rather than trusting caller discipline.
 * Unhandled mime types (never enqueued by av-scan, but a job could be requeued
 * after a mime a future version doesn't handle) are a no-op.
 */
@Processor(QUEUE.textExtract)
export class TextExtractProcessor extends WorkerHost {
  private readonly logger = new Logger(TextExtractProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<FileVersionJobData>): Promise<void> {
    const { versionId, storageKey, mime } = job.data;

    const [version] = await this.db
      .select({ avStatus: fileVersions.avStatus })
      .from(fileVersions)
      .where(eq(fileVersions.id, versionId))
      .limit(1);
    if (version?.avStatus !== 'clean') {
      this.logger.warn(
        { versionId, avStatus: version?.avStatus },
        'skipping text-extract: not a clean-verdict version',
      );
      return;
    }

    const bytes = await this.storage.getObject(storageKey);

    let text: string;
    if (mime === PDF_MIME_TYPE) {
      text = await this.extractPdf(bytes);
    } else if (mime === DOCX_MIME_TYPE) {
      text = await this.extractDocx(bytes);
    } else {
      this.logger.warn({ versionId, mime }, 'text-extract: unsupported mime, skipping');
      return;
    }

    const sanitized = text.replace(CONTROL_CHARS_PATTERN, '');
    const truncated = truncateSafe(sanitized, MAX_EXTRACTED_TEXT_LENGTH);
    await this.db
      .update(fileVersions)
      .set({ extractedText: truncated })
      .where(eq(fileVersions.id, versionId));
    this.logger.log({ versionId, chars: truncated.length }, 'text extracted');
  }

  private async extractPdf(bytes: Buffer): Promise<string> {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await withTimeout(
        parser.getText(),
        JOB_PARSE_TIMEOUT_MS,
        `pdf-parse timed out after ${JOB_PARSE_TIMEOUT_MS}ms`,
      );
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private async extractDocx(bytes: Buffer): Promise<string> {
    const result = await withTimeout(
      mammoth.extractRawText({ buffer: bytes }),
      JOB_PARSE_TIMEOUT_MS,
      `mammoth extraction timed out after ${JOB_PARSE_TIMEOUT_MS}ms`,
    );
    return result.value;
  }
}
