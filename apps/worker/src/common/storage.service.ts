import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { WorkerEnv } from '../config/env';
import { S3 } from './storage.tokens';

/**
 * Minimal MinIO/S3 primitives the worker's jobs need — read a version's bytes,
 * write derived objects (previews), and clean up (retention). Mirrors
 * apps/api/src/common/storage/storage.service.ts's client setup, but only the
 * subset of operations this side actually performs (no presigning — that's the
 * api's job, facing the browser).
 */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(S3) private readonly s3: S3Client,
    config: ConfigService<WorkerEnv, true>,
  ) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3 object has no body: ${key}`);
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Best-effort — an already-completed/expired multipart upload rejects this;
   *  callers should treat failure as "nothing to clean up", not a hard error. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }
}
