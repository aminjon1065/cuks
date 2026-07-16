import { describe, expect, it } from 'vitest';
import { createSubstitutionSchema } from './substitutions';

const base = {
  principalId: '01900000-0000-7000-8000-000000000001',
  deputyId: '01900000-0000-7000-8000-000000000002',
};

describe('createSubstitutionSchema', () => {
  it('accepts a valid open-ended substitution and defaults the scope to docflow', () => {
    const parsed = createSubstitutionSchema.parse(base);
    expect(parsed.scope).toBe('docflow');
    expect(parsed.startsAt).toBeUndefined();
  });

  it('rejects a deputy equal to the principal', () => {
    const r = createSubstitutionSchema.safeParse({ ...base, deputyId: base.principalId });
    expect(r.success).toBe(false);
  });

  it('rejects an end before the start', () => {
    const r = createSubstitutionSchema.safeParse({
      ...base,
      startsAt: '2026-07-20T00:00:00+05:00',
      endsAt: '2026-07-10T00:00:00+05:00',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid window', () => {
    const r = createSubstitutionSchema.safeParse({
      ...base,
      scope: 'all',
      startsAt: '2026-07-10T00:00:00+05:00',
      endsAt: '2026-07-20T00:00:00+05:00',
    });
    expect(r.success).toBe(true);
  });
});
