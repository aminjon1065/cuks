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
