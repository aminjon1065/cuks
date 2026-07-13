import { describe, expect, it, vi } from 'vitest';
import { StorageModule } from './storage.module';
import type { StorageService } from './storage.service';

describe('StorageModule.onModuleInit', () => {
  it('does not throw when the bucket cannot be reached at boot (MinIO briefly down)', async () => {
    const storage = {
      ensureBucket: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    } as unknown as StorageService;
    const module = new StorageModule(storage);
    await expect(module.onModuleInit()).resolves.toBeUndefined();
  });
});
