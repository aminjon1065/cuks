import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * RU/TJ key parity (plan этап 11).
 *
 * The failure this prevents is silent in the worst way: a key added to `ru` and forgotten in
 * `tg` does not crash — i18next falls back and the Tajik interface quietly shows the key path
 * or the Russian string, and nobody notices until a Tajik-speaking user does.
 *
 * Identical VALUES are not a failure: CLAUDE.md §4 makes «ключ с русским текстом как заглушка»
 * the shipped convention for `tg`, so a translation that has not happened yet is a Russian
 * string under a Tajik key, not a missing key. This test is about the KEYS.
 */
// Resolved from the package root rather than `import.meta.url`: the jsdom environment does
// not give this module a file:// URL.
const LOCALES = join(process.cwd(), 'src', 'locales');
const RU = join(LOCALES, 'ru');
const TG = join(LOCALES, 'tg');

/**
 * i18next plural suffixes. Russian uses four categories, Tajik two — so `_few` and `_many`
 * legitimately have no Tajik counterpart, and demanding them would be demanding a form the
 * language does not have.
 */
const RU_ONLY_PLURALS = ['_few', '_many'];

/**
 * Keys whose empty value is the message.
 *
 * `content.state.idle` labels the editor's save indicator, which is an `aria-live` region: the
 * region has to stay mounted for a screen reader to announce later changes at all, so «нечего
 * сказать» is an empty string rather than an unmounted element. Listed here so an accidentally
 * blank translation elsewhere still fails.
 */
const INTENTIONALLY_EMPTY = new Set(['content.state.idle']);

type Flat = Record<string, string>;

function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix] = String(value);
  return out;
}

function load(dir: string, file: string): Flat {
  return flatten(JSON.parse(readFileSync(join(dir, file), 'utf8')));
}

const namespaces = readdirSync(RU).filter((f) => f.endsWith('.json'));

describe('locale parity', () => {
  it('ships the same namespaces in both languages', () => {
    expect(
      readdirSync(TG)
        .filter((f) => f.endsWith('.json'))
        .sort(),
    ).toEqual(namespaces.sort());
  });

  it.each(namespaces)('%s: every Russian key exists in Tajik', (file) => {
    const ru = load(RU, file);
    const tg = load(TG, file);
    const missing = Object.keys(ru).filter(
      (key) => !(key in tg) && !RU_ONLY_PLURALS.some((suffix) => key.endsWith(suffix)),
    );
    expect(missing, `add these to tg/${file}`).toEqual([]);
  });

  it.each(namespaces)('%s: Tajik has no key Russian lacks', (file) => {
    const ru = load(RU, file);
    const tg = load(TG, file);
    // A key only in `tg` is dead weight: nothing reads it, because the code is written against
    // the Russian tree and every lookup falls back to it.
    expect(Object.keys(tg).filter((key) => !(key in ru))).toEqual([]);
  });

  it.each(namespaces)('%s: no value is left empty by accident', (file) => {
    for (const [dir, tree] of [
      ['ru', load(RU, file)],
      ['tg', load(TG, file)],
    ] as const) {
      const empty = Object.entries(tree)
        .filter(([key, value]) => value.trim() === '' && !INTENTIONALLY_EMPTY.has(key))
        .map(([key]) => key);
      expect(empty, `${dir}/${file}`).toEqual([]);
    }
  });
});
