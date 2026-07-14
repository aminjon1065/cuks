import { describe, expect, it } from 'vitest';
import { createGisDbAccountSchema } from './gis-integration';

describe('createGisDbAccountSchema', () => {
  it('accepts a Russian label (transliterated to the role name server-side)', () => {
    const parsed = createGisDbAccountSchema.parse({ label: 'Иванов, отдел', kind: 'reader' });
    expect(parsed).toMatchObject({ label: 'Иванов, отдел', kind: 'reader' });
  });

  it('accepts letters, digits, spaces, hyphen and underscore', () => {
    expect(
      createGisDbAccountSchema.safeParse({ label: 'GIS-reader_1', kind: 'editor' }).success,
    ).toBe(true);
  });

  it('rejects punctuation that could confuse a role name', () => {
    for (const label of ['drop; table', 'a"b', "a'b", 'a/b']) {
      expect(createGisDbAccountSchema.safeParse({ label, kind: 'reader' }).success).toBe(false);
    }
  });

  it('requires a known access kind', () => {
    expect(createGisDbAccountSchema.safeParse({ label: 'x', kind: 'superuser' }).success).toBe(
      false,
    );
    expect(createGisDbAccountSchema.safeParse({ label: '   ', kind: 'reader' }).success).toBe(
      false,
    );
  });
});
