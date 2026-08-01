import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Accessible names on the two chrome components that render their own controls (plan этап 11,
 * «Screen reader names»).
 *
 * `DataTable` and `DialogContent` live in `packages/ui`, which holds no i18n — so a pagination
 * arrow or a dialog close button can only be named by the screen that mounts it. Both have
 * English defaults so nothing is unlabelled, and that is exactly why the gap is invisible: a
 * Russian interface announcing «previous page» looks fine in every screenshot, reads wrong only
 * out loud, and — being a string in TSX rather than in a locale file — is not something the
 * RU/TJ parity test can see either.
 *
 * A source scan rather than a render test on purpose: the claim is about EVERY call site,
 * including screens nobody wrote a test for, and that is a property of the tree, not of a
 * component.
 */
const SRC = join(process.cwd(), 'src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

/** The opening tag of `component`, from `<Name` to the matching `>`, for each occurrence. */
function openingTags(source: string, component: string): string[] {
  const tags: string[] = [];
  const marker = `<${component}`;
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) return tags;
    // Not `<DialogContentSomethingElse`.
    const after = source[start + marker.length];
    if (after !== undefined && /[A-Za-z0-9_]/.test(after)) {
      from = start + marker.length;
      continue;
    }
    // Walk to the end of the tag, tracking braces so a `>` inside `{() => x}` does not end it.
    let depth = 0;
    let i = start + marker.length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(start, i + 1));
    from = i + 1;
  }
}

function relative(file: string): string {
  return file.slice(SRC.length + 1).replaceAll('\\', '/');
}

const FILES = tsxFiles(SRC);

describe('screen reader names', () => {
  it('finds the source tree it is supposed to scan', () => {
    // Guards the whole file: a broken path would make every assertion below pass vacuously.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('every DataTable is given a table name and pagination labels', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      for (const tag of openingTags(readFileSync(file, 'utf8'), 'DataTable')) {
        if (!tag.includes('labels=')) missing.push(`${relative(file)} — no labels`);
        else if (!tag.includes('table:')) missing.push(`${relative(file)} — labels without table`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every DialogContent names its own close button', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      for (const tag of openingTags(readFileSync(file, 'utf8'), 'DialogContent')) {
        if (!tag.includes('closeLabel=')) missing.push(relative(file));
      }
    }
    expect(missing).toEqual([]);
  });
});
