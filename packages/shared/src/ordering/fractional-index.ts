/**
 * Fractional indexing for kanban ordering (docs/modules/15 §2, task 4.1). An order key is a
 * base-62 string; a card/column is placed by computing a key strictly between its neighbours, so
 * a move rewrites only the moved row's key — never a cascade of `order` renumbering.
 *
 * Keys sort by ordinary lexicographic (byte) comparison, which is exactly how Postgres orders
 * `text`, so `ORDER BY order_in_column` returns board order with no extra work. Keys never end in
 * the lowest digit ('0'), the invariant the midpoint algorithm relies on (a dependency-free port
 * of the well-known scheme — https://observablehq.com/@dgreensp/implementing-fractional-indexing).
 *
 * This is the midpoint-only variant (no integer-part optimisation): correct for insert-between,
 * prepend and append, with keys that grow slowly under repeated appends — fine for a board.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;

/** A key strictly between `a` and `b` (lexicographically), where `a` = null is the start of the
 *  list and `b` = null is the end. Throws if `a >= b`. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`fractional index: ${a} >= ${b}`);
  if (b) {
    // Copy the longest common prefix, then find the midpoint of the remainders.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) {
    // There is room between the leading digits — pick the middle one.
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }
  // The leading digits are consecutive. If `b` has more than one digit, its leading digit alone
  // is already > a; otherwise descend into `a` toward +infinity.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** Validate a stored order key: non-empty, only known digits, and no trailing '0'. */
export function isValidOrderKey(key: string): boolean {
  return key.length > 0 && !key.endsWith(ZERO) && [...key].every((c) => DIGITS.includes(c));
}

/**
 * Generate an order key strictly between `a` and `b` (either may be null for the list ends). The
 * result `k` satisfies `(a === null || a < k) && (b === null || k < b)` under lexicographic
 * comparison. Throws if `a >= b` or either bound is a malformed key.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidOrderKey(a)) throw new Error(`fractional index: invalid key ${a}`);
  if (b !== null && !isValidOrderKey(b)) throw new Error(`fractional index: invalid key ${b}`);
  if (a !== null && b !== null && a >= b) throw new Error(`fractional index: ${a} >= ${b}`);
  return midpoint(a ?? '', b);
}

/**
 * Keys for `count` items placed in order between `a` and `b` (e.g. seeding a project's default
 * columns). Each is strictly between its neighbours and the bounds.
 */
export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [keyBetween(a, b)];
  const mid = keyBetween(a, b);
  const half = Math.floor(count / 2);
  return [...keysBetween(a, mid, half), mid, ...keysBetween(mid, b, count - half - 1)];
}
