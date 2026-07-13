import { create } from 'zustand';
import { UPLOAD_PART_SIZE_BYTES, type InitiateUploadResponse } from '@cuks/shared';
import { api } from '@/lib/api-client';

export type UploadStatus = 'preparing' | 'uploading' | 'completing' | 'done' | 'error';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  uploaded: number;
  status: UploadStatus;
  error?: string;
}

/** Where an upload should land — mirrors the initiate DTO (docs/modules/12 §4). */
export interface UploadTarget {
  space: 'personal' | 'org';
  parentId?: string | null;
  orgUnitId?: string | undefined;
}

interface UploadState {
  items: UploadItem[];
  /** Kick off uploads for a set of files; `onEachDone` fires per successful file
   *  so the caller can refresh the listing. */
  enqueue: (files: File[], target: UploadTarget, onEachDone: () => void) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

let counter = 0;
const nextId = (): string => `up-${Date.now()}-${counter++}`;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT one part to its presigned URL, reporting bytes for this part as they go.
 *  Uses XHR (not fetch) for upload progress, and reads the ETag off the
 *  response — MinIO exposes it for presigned PUTs. */
function putPart(url: string, body: Blob, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')?.replace(/"/g, '') ?? '';
        resolve(etag);
      } else {
        reject(new Error(`part upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('part upload network error'));
    xhr.send(body);
  });
}

export const useUploadStore = create<UploadState>((set) => {
  function patch(id: string, changes: Partial<UploadItem>): void {
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...changes } : it)) }));
  }

  async function run(item: UploadItem, file: File, target: UploadTarget, onDone: () => void) {
    let uploadId: string | null = null;
    try {
      // NOTE: WebCrypto has no streaming digest and third-party crypto is barred
      // (CLAUDE.md), so the checksum path buffers the whole file once here. Fine
      // for the desktop target across the spec's ≤1.5 GB range; very large files
      // (near the 2 GiB cap) are a documented limitation (docs/plan/STATUS.md).
      const buffer = await file.arrayBuffer();
      const checksumSha256 = await sha256Hex(buffer);

      patch(item.id, { status: 'uploading' });
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
      const reportProgress = () =>
        patch(item.id, { uploaded: partLoaded.reduce((a, b) => a + b, 0) });

      const parts = await Promise.all(
        init.parts.map(async (part, i) => {
          const start = i * UPLOAD_PART_SIZE_BYTES;
          const chunk = file.slice(start, start + UPLOAD_PART_SIZE_BYTES);
          const eTag = await putPart(part.url, chunk, (loaded) => {
            partLoaded[i] = loaded;
            reportProgress();
          });
          return { partNumber: part.partNumber, eTag };
        }),
      );

      patch(item.id, { status: 'completing', uploaded: file.size });
      await api.post(`/v1/files/uploads/${init.uploadId}/complete`, { parts, checksumSha256 });
      patch(item.id, { status: 'done' });
      onDone();
    } catch (err) {
      patch(item.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      // Release the staging row + S3 multipart now rather than waiting for the
      // 24h retention sweep. Best-effort — the sweep is still the backstop.
      if (uploadId) {
        void api.post(`/v1/files/uploads/${uploadId}/abort`).catch(() => {});
      }
    }
  }

  return {
    items: [],
    enqueue: (files, target, onEachDone) => {
      const newItems: UploadItem[] = files.map((f) => ({
        id: nextId(),
        name: f.name,
        size: f.size,
        uploaded: 0,
        status: 'preparing',
      }));
      set((s) => ({ items: [...s.items, ...newItems] }));
      newItems.forEach((item, i) => void run(item, files[i]!, target, onEachDone));
    },
    remove: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
    clearFinished: () =>
      set((s) => ({
        items: s.items.filter((it) => it.status !== 'done' && it.status !== 'error'),
      })),
  };
});
