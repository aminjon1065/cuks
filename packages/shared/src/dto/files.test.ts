import { describe, expect, it } from 'vitest';
import {
  completeUploadSchema,
  createFolderSchema,
  initiateUploadSchema,
  patchNodeSchema,
  treeQuerySchema,
} from './files';

describe('files DTOs', () => {
  it('tree query accepts an omitted parentId (space root)', () => {
    const parsed = treeQuerySchema.parse({ space: 'personal' });
    expect(parsed.parentId).toBeUndefined();
  });

  it('rejects an invalid space', () => {
    expect(() => treeQuerySchema.parse({ space: 'shared' })).toThrow();
  });

  it('createFolder requires a non-empty name', () => {
    expect(() => createFolderSchema.parse({ space: 'personal', name: '' })).toThrow();
  });

  it('initiateUpload requires a positive size', () => {
    expect(() =>
      initiateUploadSchema.parse({
        space: 'personal',
        name: 'a.pdf',
        size: 0,
        mime: 'application/pdf',
      }),
    ).toThrow();
    expect(
      initiateUploadSchema.parse({
        space: 'personal',
        name: 'a.pdf',
        size: 100,
        mime: 'application/pdf',
      }).size,
    ).toBe(100);
  });

  it('completeUpload requires a lowercase hex sha256 digest', () => {
    const parts = [{ partNumber: 1, eTag: '"abc"' }];
    expect(() => completeUploadSchema.parse({ parts, checksumSha256: 'not-hex' })).toThrow();
    expect(
      () => completeUploadSchema.parse({ parts, checksumSha256: 'A'.repeat(64) }), // uppercase rejected
    ).toThrow();
    expect(
      completeUploadSchema.parse({ parts, checksumSha256: 'a'.repeat(64) }).checksumSha256,
    ).toBe('a'.repeat(64));
  });

  it('patchNode requires at least one field', () => {
    expect(() => patchNodeSchema.parse({})).toThrow();
    expect(patchNodeSchema.parse({ name: 'New name' }).name).toBe('New name');
    expect(patchNodeSchema.parse({ parentId: null }).parentId).toBeNull();
  });
});
