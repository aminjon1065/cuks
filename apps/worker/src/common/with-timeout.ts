/** Races a promise against a timeout so a hung parser (sharp/pdf-parse/mammoth
 *  on a pathological file) can't stall a worker slot indefinitely. The original
 *  promise is left to settle on its own (Node has no way to cancel arbitrary
 *  work) — this only bounds how long the *caller* waits for it. Worker-local
 *  (not packages/shared) since it needs Node's timer globals, which the
 *  isomorphic shared package's tsconfig deliberately doesn't include. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
