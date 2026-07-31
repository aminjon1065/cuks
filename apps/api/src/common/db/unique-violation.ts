/**
 * Recognising a Postgres unique violation (SQLSTATE 23505) through whatever wraps it.
 *
 * Drizzle 0.45 rethrows driver errors as `DrizzleQueryError` and hangs the original off
 * `cause`, so a check that reads `err.code` on the top-level object silently stops matching —
 * and every «this name is taken» conflict quietly becomes a 500, which is exactly the class of
 * bug that only shows up in production. Walking the chain matches both shapes, and keeps
 * matching if a future version changes its mind again.
 *
 * The depth limit is a cycle guard, not a semantic one: `cause` is a plain property and a
 * self-referencing error would otherwise loop forever.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let cur: unknown = err, depth = 0; cur && depth < 8; depth++) {
    if (typeof cur !== 'object') return false;
    if ('code' in cur && (cur as { code?: unknown }).code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
