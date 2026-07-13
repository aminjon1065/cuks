import { describe, expect, it, vi } from 'vitest';
import { PreviewProcessor } from './preview.processor';

const sharpChain = {
  resize: vi.fn(function (this: unknown) {
    return this;
  }),
  webp: vi.fn(function (this: unknown) {
    return this;
  }),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-bytes')),
};
vi.mock('sharp', () => ({ default: vi.fn(() => sharpChain) }));

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return obj;
}

function makeProcessor(avStatus: string | null = 'clean') {
  const db = { select: vi.fn(() => selectChain(avStatus === null ? [] : [{ avStatus }])) };
  const storage = {
    getObject: vi.fn().mockResolvedValue(Buffer.from('original-image-bytes')),
    putObject: vi.fn().mockResolvedValue(undefined),
  };
  const processor = new PreviewProcessor(db as never, storage as never);
  return { processor, db, storage };
}

describe('PreviewProcessor', () => {
  it('generates and stores all 3 preview sizes as webp for a clean-verdict version', async () => {
    const { processor, storage } = makeProcessor('clean');
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'image/png' },
    } as never);

    expect(storage.putObject).toHaveBeenCalledTimes(3);
    const keys = storage.putObject.mock.calls.map((c) => c[0]);
    expect(keys).toEqual([
      'previews/v1/small.webp',
      'previews/v1/medium.webp',
      'previews/v1/large.webp',
    ]);
    for (const call of storage.putObject.mock.calls) {
      expect(call[2]).toBe('image/webp');
    }
  });

  it('skips a version that is not (or no longer) clean-verdict, without touching storage', async () => {
    const { processor, storage } = makeProcessor('pending');
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'image/png' },
    } as never);
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('skips when the version row cannot be found', async () => {
    const { processor, storage } = makeProcessor(null);
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'image/png' },
    } as never);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
