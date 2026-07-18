/** Join-link helpers (docs/modules/14 §2: «карточка встречи со ссылкой»). */

/** Absolute join link for a call room — the `/app/meet/r/:slug` route. */
export function roomUrl(slug: string): string {
  return `${window.location.origin}/app/meet/r/${slug}`;
}

/**
 * Copy text to the clipboard; `false` when the Clipboard API is unavailable
 * (plain-HTTP origin inside the isolated network) so the caller can fall back
 * to showing the link itself.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
