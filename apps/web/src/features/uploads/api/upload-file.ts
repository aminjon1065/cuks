import { UPLOAD_PART_SIZE_BYTES, type FsNodeDto, type InitiateUploadResponse } from '@cuks/shared';
import { api } from '@/lib/api-client';

/** Coarse lifecycle of a single file upload, surfaced to the UI. */
export type UploadStatus = 'preparing' | 'uploading' | 'completing' | 'done' | 'error';

/** Where an upload should land — mirrors the initiate DTO (docs/modules/12 §4).
 *  `system` space isn't offered here: the API rejects direct system-space uploads
 *  (fs-nodes.service `system_space_unsupported`); module attachments are created
 *  by each module's own endpoint (added in that module's phase). */
export interface UploadTarget {
  space: 'personal' | 'org';
  parentId?: string | null;
  orgUnitId?: string | undefined;
}

export interface UploadHandlers {
  /** Bytes transferred so far for this file (summed across parts). */
  onProgress?: (uploaded: number) => void;
  onStatus?: (status: UploadStatus) => void;
  /** Abort the upload (used by the local manager to cancel a queued item). */
  signal?: AbortSignal;
}

class AbortError extends Error {
  constructor() {
    super('upload aborted');
    this.name = 'AbortError';
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT one part to its presigned URL, reporting bytes for this part as they go.
 *  Uses XHR (not fetch) for upload progress, and reads the ETag off the
 *  response — MinIO exposes it for presigned PUTs. Honors `signal` for cancel. */
function putPart(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = (): void => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);

    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')?.replace(/"/g, '') ?? '';
        resolve(etag);
      } else {
        reject(new Error(`part upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('part upload network error'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new AbortError());
    };
    xhr.send(body);
  });
}

/**
 * Upload one file to a target via presigned multipart (docs/modules/12 §4):
 * sha256 the bytes → initiate → XHR-PUT each part to MinIO with progress →
 * complete. Returns the created/updated node. On any failure (including cancel)
 * the S3 multipart session + staging row are released via the abort endpoint
 * rather than waiting for the 24h retention sweep. This is the single source of
 * truth for the upload flow — both the global dock store and the local
 * attachment manager drive it.
 */
export async function uploadFile(
  file: File,
  target: UploadTarget,
  handlers: UploadHandlers = {},
): Promise<FsNodeDto> {
  const { onProgress, onStatus, signal } = handlers;
  let uploadId: string | null = null;
  try {
    // NOTE: WebCrypto has no streaming digest and third-party crypto is barred
    // (CLAUDE.md), so the checksum path buffers the whole file once here. Fine for
    // the desktop target across the spec's ≤1.5 GB range; very large files (near
    // the 2 GiB cap) are a documented limitation (docs/plan/STATUS.md).
    const buffer = await file.arrayBuffer();
    if (signal?.aborted) throw new AbortError();
    const checksumSha256 = await sha256Hex(buffer);

    onStatus?.('uploading');
    const init = await api.post<InitiateUploadResponse>('/v1/files/uploads', {
      space: target.space,
      ...(target.parentId ? { parentId: target.parentId } : {}),
      ...(target.orgUnitId ? { orgUnitId: target.orgUnitId } : {}),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    });
    uploadId = init.uploadId;

    // Track per-part progress so retried/parallel parts sum correctly.
    const partLoaded = new Array(init.parts.length).fill(0) as number[];
    const reportProgress = (): void => onProgress?.(partLoaded.reduce((a, b) => a + b, 0));

    const parts = await Promise.all(
      init.parts.map(async (part, i) => {
        const start = i * UPLOAD_PART_SIZE_BYTES;
        const chunk = file.slice(start, start + UPLOAD_PART_SIZE_BYTES);
        const eTag = await putPart(
          part.url,
          chunk,
          (loaded) => {
            partLoaded[i] = loaded;
            reportProgress();
          },
          signal,
        );
        return { partNumber: part.partNumber, eTag };
      }),
    );

    onStatus?.('completing');
    onProgress?.(file.size);
    const node = await api.post<FsNodeDto>(`/v1/files/uploads/${init.uploadId}/complete`, {
      parts,
      checksumSha256,
    });
    onStatus?.('done');
    return node;
  } catch (err) {
    onStatus?.('error');
    // Release the staging row + S3 multipart now rather than waiting for the 24h
    // retention sweep. Best-effort — the sweep is still the backstop.
    if (uploadId) {
      void api.post(`/v1/files/uploads/${uploadId}/abort`).catch(() => {});
    }
    throw err;
  }
}

/** True when an error came from an explicit cancel (vs. a real failure). */
export function isUploadAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
