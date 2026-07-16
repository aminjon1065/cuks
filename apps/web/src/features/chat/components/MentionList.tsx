import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

export interface MentionItem {
  id: string;
  label: string;
}

export interface MentionListHandle {
  /** Returns true if the key was consumed (arrow navigation / enter select). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Suggestion popup for `@`-mentions in the composer (docs/modules/13 §5). Driven by TipTap's
 * suggestion utility via a ReactRenderer; exposes {@link MentionListHandle.onKeyDown} so the editor
 * can route arrow/enter keys here while the popup is open.
 */
export const MentionList = forwardRef<
  MentionListHandle,
  { items: MentionItem[]; command: (item: MentionItem) => void; emptyLabel: string }
>(function MentionList({ items, command, emptyLabel }, ref) {
  const [active, setActive] = useState(0);

  useEffect(() => setActive(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === 'ArrowUp') {
        setActive((i) => (i + items.length - 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'ArrowDown') {
        setActive((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[active];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-56 rounded-md border border-border bg-surface p-2 text-[13px] text-text-muted shadow-lg">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="w-56 overflow-hidden rounded-md border border-border bg-surface p-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            command(item);
          }}
          onMouseEnter={() => setActive(i)}
          className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[13px] ${
            i === active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-surface-2'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
});
