/** Small dependency-free helpers shared across the stack. */

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Build a `module.entity.reason` error code (docs/04 §REST). */
export function errorCode(module: string, entity: string, reason: string): string {
  return `${module}.${entity}.${reason}`;
}

/** Clamp a page-size to the allowed range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** MinIO key a preview lives at — shared so the worker (writes it) and the api
 *  (reads it) can never drift on the format (docs/modules/12 §5). */
export function previewObjectKey(versionId: string, size: string): string {
  return `previews/${versionId}/${size}.webp`;
}

/**
 * Extract plain text from a TipTap / ProseMirror JSON doc (docs/modules/15 §2) — used to keep a
 * `description_text` mirror for full-text search. Walks the node tree collecting `text` leaves,
 * joining block nodes with spaces; ignores marks/attrs. Returns '' for anything unparsable.
 */
export function tiptapPlainText(doc: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Wrap plain text as a minimal TipTap / ProseMirror JSON doc (docs/modules/15 §2) — one paragraph
 * per line, empty lines becoming empty paragraphs. Lets the card description stay TipTap-shaped
 * (and keep feeding `description_text`/FTS via {@link tiptapPlainText}) until a rich editor lands.
 */
export function plainTextToTiptap(text: string): {
  type: 'doc';
  content: { type: 'paragraph'; content?: { type: 'text'; text: string }[] }[];
} {
  const lines = text.split('\n');
  return {
    type: 'doc',
    content: lines.map((line) =>
      line.length
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' },
    ),
  };
}

/**
 * Reconstruct editable plain text from a TipTap doc, preserving paragraph breaks as newlines —
 * the inverse of {@link plainTextToTiptap}. (`tiptapPlainText` flattens everything to one line for
 * FTS; this keeps line structure for the description editor.)
 */
export function tiptapToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const d = doc as { content?: unknown[] };
  if (!Array.isArray(d.content)) return tiptapPlainText(doc);
  return d.content.map((block) => tiptapPlainText(block)).join('\n');
}

/** Truncates a string to at most `maxLength` UTF-16 code units without splitting
 *  a surrogate pair — a plain `slice(0, n)` can cut between a high and low
 *  surrogate (e.g. an emoji straddling the boundary), producing a lone surrogate
 *  that silently mangles to U+FFFD on UTF-8 encoding. */
export function truncateSafe(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = maxLength;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // lone high surrogate at the cut point
  return text.slice(0, end);
}
