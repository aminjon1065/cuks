import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './unique-violation';

/**
 * Drizzle 0.45 rethrows driver errors wrapped in `DrizzleQueryError`, so the shape the check
 * has to survive is «the real error is one or more `cause` links down». Getting this wrong is
 * silent: every duplicate-name conflict in the product turns into a 500.
 */
describe('isUniqueViolation', () => {
  it('recognises the raw driver error', () => {
    expect(isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' }))).toBe(true);
  });

  it('recognises it through a wrapper that hid it in `cause`', () => {
    const driver = Object.assign(new Error('duplicate key'), { code: '23505' });
    const wrapped = Object.assign(new Error('Failed query'), { cause: driver });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation({ cause: { cause: driver } })).toBe(true);
  });

  it('does not mistake another SQLSTATE for a duplicate', () => {
    const fk = Object.assign(new Error('fk'), { code: '23503' });
    expect(isUniqueViolation(fk)).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('q'), { cause: fk }))).toBe(false);
  });

  it('survives a cause cycle instead of hanging', () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });

  it('says no to the things that are not errors at all', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
