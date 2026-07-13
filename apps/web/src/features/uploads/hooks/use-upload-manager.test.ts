import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsNodeDto } from '@cuks/shared';
import type { UploadHandlers, UploadTarget } from '../api/upload-file';

// Mock the shared upload flow so the manager's orchestration is tested in
// isolation (no network / MinIO).
const uploadFile = vi.fn();
vi.mock('../api/upload-file', () => ({
  uploadFile: (file: File, target: UploadTarget, handlers: UploadHandlers) =>
    uploadFile(file, target, handlers),
  isUploadAbort: (err: unknown) => err instanceof Error && err.name === 'AbortError',
}));

// Imported after the mock is registered.
const { useUploadManager } = await import('./use-upload-manager');

const target: UploadTarget = { space: 'personal' };
const makeFile = (name = 'a.txt'): File => new File(['x'], name, { type: 'text/plain' });
const node = (id: string): FsNodeDto =>
  ({ id, name: 'a.txt', kind: 'file', sizeCached: 1, avStatus: 'pending' }) as FsNodeDto;

afterEach(() => {
  uploadFile.mockReset();
});

describe('useUploadManager', () => {
  it('captures the completed node and exposes it via `nodes`', async () => {
    uploadFile.mockImplementation(async (file: File, _t: UploadTarget, h: UploadHandlers) => {
      h.onStatus?.('uploading');
      h.onProgress?.(file.size);
      return node('n1');
    });

    const { result } = renderHook(() => useUploadManager(target));
    act(() => result.current.add([makeFile()]));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]?.id).toBe('n1');
  });

  it('marks a failed upload as error and keeps it out of `nodes`', async () => {
    uploadFile.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useUploadManager(target));
    act(() => result.current.add([makeFile()]));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    expect(result.current.items[0]?.error).toBe('network down');
    expect(result.current.nodes).toHaveLength(0);
  });

  it('aborts the in-flight upload and drops the row on remove', async () => {
    let capturedSignal: AbortSignal | undefined;
    uploadFile.mockImplementation(
      (_f: File, _t: UploadTarget, h: UploadHandlers) =>
        new Promise<FsNodeDto>((_resolve, reject) => {
          capturedSignal = h.signal;
          h.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );

    const { result } = renderHook(() => useUploadManager(target));
    act(() => result.current.add([makeFile()]));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const id = result.current.items[0]!.id;
    act(() => result.current.remove(id));

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.items).toHaveLength(0);
  });
});
