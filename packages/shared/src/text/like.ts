/**
 * Escape the LIKE/ILIKE metacharacters in user input.
 *
 * Without this, `%` and `_` typed into a search box are wildcards rather than characters: a
 * user searching for the literal string `100%` matches everything, and — worse for a document
 * register — a single `_` silently widens the result set past what the person believes they
 * asked for. It is not an injection (drizzle parameterises the value); it is a correctness and
 * a least-astonishment problem, and on a register it is also a performance one.
 *
 * The backslash must be escaped FIRST, or escaping `%` would then have its own backslash
 * escaped again. Postgres's default LIKE escape character is the backslash, so no
 * `ESCAPE` clause is needed at the call site.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%value%` with the value escaped — the «contains» pattern, spelled once. */
export function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

/** `value%` with the value escaped — the «starts with» pattern, which an index can still use. */
export function likeStartsWith(value: string): string {
  return `${escapeLike(value)}%`;
}
