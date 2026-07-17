import { useEffect } from 'react';

/** Product acronym — same in ru/tg (common.appName). Kept as a constant so every tab shows app context. */
const APP = 'ЦУКС';

/**
 * Set the browser tab title for the current screen (docs/06 §8: «документ title корректны»). Pass the
 * localized page title; the next screen overwrites it. Renders as "<Page> · ЦУКС".
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
