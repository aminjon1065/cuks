import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly-changing value — a search box feeding a query.
 *
 * Without it every keystroke is a request: the register search is the most expensive read in
 * the product and carries its own rate budget, so an undebounced box spends that budget on
 * answers nobody reads and then rate-limits the one they wanted.
 *
 * Returns the value unchanged on the first render, so the initial query still fires at once.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
