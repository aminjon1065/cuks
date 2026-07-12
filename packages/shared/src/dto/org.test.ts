import { describe, expect, it } from 'vitest';
import { createOrgUnitSchema, moveOrgUnitSchema } from './org';

describe('org DTOs', () => {
  it('accepts a root unit (null parent) and a valid type', () => {
    const parsed = createOrgUnitSchema.parse({ name: 'КЧС', type: 'committee', parentId: null });
    expect(parsed.type).toBe('committee');
    expect(parsed.parentId).toBeNull();
  });

  it('rejects an invalid org-unit type', () => {
    expect(() => createOrgUnitSchema.parse({ name: 'X', type: 'ministry' })).toThrow();
  });

  it('move requires an explicit parentId (null allowed for root)', () => {
    expect(moveOrgUnitSchema.parse({ parentId: null }).parentId).toBeNull();
    expect(() => moveOrgUnitSchema.parse({})).toThrow();
  });
});
