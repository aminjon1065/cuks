import { describe, expect, it } from 'vitest';
import { assertVersionServable } from './docflow-files.service';

/** Assert the gate rejects with the given code, and expose the thrown exception. */
function expectRejected(fn: () => unknown, code: string): { details?: Record<string, unknown> } {
  try {
    fn();
    expect.unreachable('expected the antivirus gate to reject the version');
  } catch (error) {
    expect(error).toMatchObject({ code });
    return error as { details?: Record<string, unknown> };
  }
  throw new Error('unreachable');
}

describe('assertVersionServable', () => {
  it('serves a clean version', () => {
    expect(() => assertVersionServable('clean')).not.toThrow();
  });

  it('refuses an infected version and says why', () => {
    const err = expectRejected(() => assertVersionServable('infected'), 'docflow.file.not_safe');
    // The UI distinguishes «заражён» from «идёт проверка» off this field.
    expect(err.details).toMatchObject({ avStatus: 'infected' });
  });

  it('refuses a version still in quarantine — stricter than the plain file manager', () => {
    // A document body reaches every route participant and acquaintance, so an
    // unscanned file must not be distributed even though its uploader could read it.
    const err = expectRejected(() => assertVersionServable('pending'), 'docflow.file.not_safe');
    expect(err.details).toMatchObject({ avStatus: 'pending' });
  });

  it('treats a missing version as not cleared, never as servable', () => {
    const err = expectRejected(() => assertVersionServable(null), 'docflow.file.not_safe');
    expect(err.details).toMatchObject({ avStatus: 'pending' });
  });
});
