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
