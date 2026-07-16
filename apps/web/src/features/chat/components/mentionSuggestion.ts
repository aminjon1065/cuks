import { ReactRenderer } from '@tiptap/react';
import type { MentionOptions } from '@tiptap/extension-mention';
import { MentionList, type MentionItem, type MentionListHandle } from './MentionList';

/** The `suggestion` config shape TipTap's Mention extension accepts (avoids importing @tiptap/suggestion,
 *  which isn't a direct dependency). */
type MentionSuggestion = NonNullable<MentionOptions['suggestion']>;

/**
 * `@`-mention suggestion for the composer (docs/modules/13 §5). Filters the channel members by the
 * typed query and shows {@link MentionList} in a body-appended popup positioned from the caret rect —
 * no tippy dependency. `setOpen` lets the composer know a popup is active so Enter selects a mention
 * instead of sending the message.
 */
export function makeMentionSuggestion(
  getMembers: () => MentionItem[],
  setOpen: (open: boolean) => void,
  emptyLabel: string,
): MentionSuggestion {
  return {
    char: '@',
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return getMembers()
        .filter((m) => m.label.toLowerCase().includes(q))
        .slice(0, 8);
    },
    render: () => {
      let component: ReactRenderer<MentionListHandle> | null = null;
      let popup: HTMLDivElement | null = null;

      const place = (rect: (() => DOMRect | null) | null | undefined): void => {
        if (!popup || !rect) return;
        const r = rect();
        if (!r) return;
        popup.style.left = `${r.left}px`;
        popup.style.top = `${r.bottom + 6}px`;
      };

      return {
        onStart: (props: {
          items: MentionItem[];
          command: (item: MentionItem) => void;
          clientRect?: (() => DOMRect | null) | null;
          editor: unknown;
        }) => {
          setOpen(true);
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command, emptyLabel },
            editor: props.editor as never,
          });
          popup = document.createElement('div');
          popup.style.position = 'fixed';
          popup.style.zIndex = '60';
          popup.appendChild(component.element);
          document.body.appendChild(popup);
          place(props.clientRect);
        },
        onUpdate: (props: {
          items: MentionItem[];
          command: (item: MentionItem) => void;
          clientRect?: (() => DOMRect | null) | null;
        }) => {
          component?.updateProps({ items: props.items, command: props.command, emptyLabel });
          place(props.clientRect);
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === 'Escape') return true;
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          setOpen(false);
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
