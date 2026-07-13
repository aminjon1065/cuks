import { create } from 'zustand';
import type { FsNodeDto } from '@cuks/shared';
import { uploadFile, type UploadStatus, type UploadTarget } from './upload-file';

export type { UploadStatus, UploadTarget };

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  uploaded: number;
  status: UploadStatus;
  error?: string;
}

interface UploadState {
  items: UploadItem[];
  /** Kick off uploads for a set of files; `onEachDone` fires per successful file
   *  with the created node so the caller can refresh its listing. */
  enqueue: (files: File[], target: UploadTarget, onEachDone: (node: FsNodeDto) => void) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

let counter = 0;
const nextId = (): string => `up-${Date.now()}-${counter++}`;

/**
 * Global upload store backing the progress dock (docs/modules/12 §4: progress
 * persists across navigation). Thin wrapper over {@link uploadFile}; the proven
 * multipart logic lives there and is shared with the per-field upload manager.
 */
export const useUploadStore = create<UploadState>((set) => {
  function patch(id: string, changes: Partial<UploadItem>): void {
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...changes } : it)) }));
  }

  async function run(
    item: UploadItem,
    file: File,
    target: UploadTarget,
    onDone: (node: FsNodeDto) => void,
  ): Promise<void> {
    try {
      const node = await uploadFile(file, target, {
        onProgress: (uploaded) => patch(item.id, { uploaded }),
        onStatus: (status) => patch(item.id, { status }),
      });
      onDone(node);
    } catch (err) {
      patch(item.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
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
