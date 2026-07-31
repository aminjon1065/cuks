import { describe, expect, it } from 'vitest';
import { escapeLike, likeContains, likeStartsWith } from './like';

// Backslashes are spelled with String.raw so the expectations read as the SQL pattern they
// actually are, instead of as a pile of doubled escapes.
const raw = String.raw;

/**
 * The bug this prevents is quiet: `%` typed into a search box is not an error, it just
 * silently returns everything. On a document register that reads as «поиск не работает».
 */
describe('escapeLike', () => {
  it('turns the wildcards back into characters', () => {
    expect(escapeLike('100%')).toBe(raw`100\%`);
    expect(escapeLike('a_b')).toBe(raw`a\_b`);
    expect(escapeLike('%_%')).toBe(raw`\%\_\%`);
  });

  it('escapes the backslash first, so the escapes do not eat each other', () => {
    // Escaping `%` before `\` would produce `\\%` — an escaped backslash followed by a LIVE
    // wildcard, which is exactly the case this ordering exists for.
    expect(escapeLike(raw`\%`)).toBe(raw`\\\%`);
  });

  it('leaves ordinary text — including Cyrillic and a reg number — alone', () => {
    expect(escapeLike('П-2026/0001')).toBe('П-2026/0001');
    expect(escapeLike('О мерах')).toBe('О мерах');
    expect(escapeLike('')).toBe('');
  });

  it('builds the two patterns the register actually uses', () => {
    expect(likeContains('50%')).toBe(raw`%50\%%`);
    expect(likeStartsWith('П-2026/')).toBe('П-2026/%');
  });
});
