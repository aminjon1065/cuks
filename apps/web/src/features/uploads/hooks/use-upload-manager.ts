import { useCallback, useRef, useState } from 'react';
import type { FsNodeDto } from '@cuks/shared';
import {
  isUploadAbort,
  uploadFile,
  type UploadStatus,
  type UploadTarget,
} from '../api/upload-file';

export interface ManagedUpload {
  id: string;
  name: string;
  size: number;
  mime: string;
  uploaded: number;
  status: UploadStatus;
  error?: string;
  /** Set once the upload completes — the persisted node the module links to. */
  node?: FsNodeDto;
}

export interface UploadManager {
  items: ManagedUpload[];
  /** Successfully-uploaded nodes, in order — what a module form persists. */
  nodes: FsNodeDto[];
  add: (files: File[]) => void;
  /** Cancel (if in flight) and drop an item from the list. */
  remove: (id: string) => void;
  reset: () => void;
}

let counter = 0;
const nextId = (): string => `att-${Date.now()}-${counter++}`;

/**
 * Local, per-field upload manager for module attachment fields (docs/modules/12
 * §3). Unlike the global dock store, it hands completed {@link FsNodeDto}s back to
 * the caller so a form can link them, and cancels an in-flight upload when a row
 * is removed. Shares the multipart flow with the dock via {@link uploadFile}.
 */
export function useUploadManager(target: UploadTarget): UploadManager {
  const [items, setItems] = useState<ManagedUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  // Keep the latest target without re-creating `add` on every render — an upload
  // started now should land at the target current at call time.
  const targetRef = useRef(target);
  targetRef.current = target;

  const patch = useCallback((id: string, changes: Partial<ManagedUpload>): void => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  }, []);

  const add = useCallback(
    (files: File[]): void => {
      const started = files.map((file) => {
        const id = nextId();
        const controller = new AbortController();
        controllers.current.set(id, controller);
        const item: ManagedUpload = {
          id,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          uploaded: 0,
          status: 'preparing',
        };
        void uploadFile(file, targetRef.current, {
          signal: controller.signal,
          onProgress: (uploaded) => patch(id, { uploaded }),
          onStatus: (status) => patch(id, { status }),
        })
          .then((node) => patch(id, { status: 'done', node, uploaded: node.sizeCached }))
          .catch((err) => {
            // A cancel removed the row already — nothing to report.
            if (isUploadAbort(err)) return;
            patch(id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
          })
          .finally(() => controllers.current.delete(id));
        return item;
      });
      setItems((prev) => [...prev, ...started]);
    },
    [patch],
  );

  const remove = useCallback((id: string): void => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const reset = useCallback((): void => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setItems([]);
  }, []);

  const nodes = items
    .filter((it): it is ManagedUpload & { node: FsNodeDto } => !!it.node)
    .map((it) => it.node);

  return { items, nodes, add, remove, reset };
}
