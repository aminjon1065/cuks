import { useRef } from 'react';

/**
 * Put keyboard focus back where it was when an overlay closes.
 *
 * Radix does this for you — but only through `<DialogTrigger>`. Its `onCloseAutoFocus` handler
 * calls `preventDefault()` and then focuses `triggerRef.current`, and that `preventDefault()`
 * also cancels `FocusScope`'s own restore. This app opens every dialog and sheet from controlled
 * state (`<Dialog open={…}>` with an ordinary `<Button onClick>`), so there is no trigger, the
 * ref is null, and both restore paths are gone: focus lands on `<body>`.
 *
 * What that costs a keyboard user is not subtle. Escape out of «Создать документ» and you are at
 * the top of the page, having to Tab past the whole navigation to get back to the button you
 * were standing on. It is invisible to every mouse-driven test and to every screenshot.
 *
 * The previously focused element is captured in `onOpenAutoFocus`, which Radix dispatches BEFORE
 * moving focus into the overlay — at that moment `document.activeElement` is still the control
 * the user pressed.
 */
export function useFocusRestore(): {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const previous = useRef<HTMLElement | null>(null);

  return {
    onOpenAutoFocus: (): void => {
      const active = document.activeElement;
      previous.current = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    onCloseAutoFocus: (event: Event): void => {
      const target = previous.current;
      previous.current = null;
      // Gone from the DOM — the row that opened the panel was deleted, the list re-rendered.
      // Leave the event alone so Radix/FocusScope can do whatever it would have done.
      if (!target || !target.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}
