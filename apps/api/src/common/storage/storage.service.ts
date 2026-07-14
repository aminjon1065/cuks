import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DOWNLOAD_URL_EXPIRY_SECONDS,
  MAX_FILE_SIZE_BYTES,
  UPLOAD_PART_URL_EXPIRY_SECONDS,
} from '@cuks/shared';
import { AppException } from '../exceptions/app.exception';
import { ConfigService } from '../../config/config.service';
import { S3 } from './storage.tokens';

export interface UploadPart {
  partNumber: number;
  eTag: string;
}

export interface CompletedUpload {
  eTag: string;
  size: number;
}

/**
 * MinIO/S3 storage primitives (docs/02 ADR-6, docs/modules/12 §4, docs/09 §2):
 * bucket provisioning, presigned multipart upload lifecycle, presigned download.
 *
 * Scope note (docs/plan/STATUS.md, task 1.1): this is the storage-layer service
 * only. It does not expose `/files/*` HTTP routes — those need `fs_nodes` (task
 * 1.2) to attach an upload to a real entity, so building them now would mean
 * reworking them immediately after. Callers pass their own storage keys.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3) private readonly s3: S3Client,
    config: ConfigService,
  ) {
    this.bucket = config.get('S3_BUCKET');
  }

  /** Idempotent — safe to call on every boot (mirrors `ensure_audit_log_partition`). */
  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.logger.log(`created bucket "${this.bucket}"`);
  }

  /** Rejects up front if the declared size exceeds the 2 GiB cap (docs/09 §2). */
  async initiateUpload(
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ uploadId: string }> {
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      throw AppException.badRequest('files.upload.too_large', 'File exceeds the 2 GiB limit', {
        maxBytes: MAX_FILE_SIZE_BYTES,
        contentLength,
      });
    }
    const res = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) throw new Error('S3 did not return an UploadId');
    return { uploadId: res.UploadId };
  }

  /** Presigned PUT URL for one part; the client uploads the chunk directly to MinIO. */
  async getUploadPartUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.s3, command, { expiresIn: UPLOAD_PART_URL_EXPIRY_SECONDS });
  }

  /** Merges the uploaded parts server-side and returns the final object's ETag/size. */
  async completeUpload(
    key: string,
    uploadId: string,
    parts: UploadPart[],
  ): Promise<CompletedUpload> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag })),
        },
      }),
    );
    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!head.ETag || head.ContentLength === undefined) {
      throw new Error('S3 did not return object metadata after complete');
    }
    return { eTag: head.ETag, size: head.ContentLength };
  }

  /** Cleans up an in-progress upload (client cancel, chunk failure past retry). */
  async abortUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  /** Deletes a completed object — e.g. rolling back an upload that failed a
   *  post-completion check (size/quota) or a DB write after the S3 side committed. */
  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Used by the preview endpoint (1.3) — the worker may not have generated a
   *  given size yet, or the file may not be an image at all. */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /** Size of an uploaded object, or `null` if it isn't there. The geo-import
   *  checks the object it is about to queue actually arrived (2.8). */
  async objectSize(key: string): Promise<number | null> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Presigned single-shot PUT. The multipart flow above exists for files up to
   * 2 GiB; a geo-import source is one bounded object (docs/modules/10 §6), so the
   * browser uploads it in one request without a staging record to reconcile.
   */
  async getUploadUrl(
    key: string,
    contentType: string,
    expiresIn = UPLOAD_PART_URL_EXPIRY_SECONDS,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Presigned GET with a forced `Content-Disposition: attachment` (docs/09 §2:
   * never expose the bucket for direct listing/inline serving). `filename*`
   * (RFC 5987) carries non-ASCII names (Cyrillic document titles are the norm here).
   */
  async getDownloadUrl(
    key: string,
    filename: string,
    expiresIn = DOWNLOAD_URL_EXPIRY_SECONDS,
  ): Promise<string> {
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    '$metadata' in err &&
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
  );
}
