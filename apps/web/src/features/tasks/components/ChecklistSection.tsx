import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Input, cn, toast } from '@cuks/ui';
import type { ChecklistItemDto } from '@cuks/shared';
import {
  useAddChecklistItem,
  useRemoveChecklistItem,
  useUpdateChecklistItem,
} from '../api/queries';

/** A card's checklist with a completion bar (docs/modules/15 §4). Editing is hidden for viewers. */
export function ChecklistSection({
  projectId,
  cardId,
  items,
  readOnly,
}: {
  projectId: string;
  cardId: string;
  items: ChecklistItemDto[];
  readOnly: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const add = useAddChecklistItem(projectId, cardId);
  const update = useUpdateChecklistItem(projectId, cardId);
  const remove = useRemoveChecklistItem(projectId, cardId);
  const [text, setText] = useState('');

  const done = items.filter((i) => i.isDone).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const submit = () => {
    if (!text.trim()) return;
    add.mutate(
      { text: text.trim() },
      { onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }) },
    );
    setText('');
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span className="font-medium text-text">{t('card.checklist')}</span>
        {items.length ? (
          <span>
            {done}/{items.length}
          </span>
        ) : null}
      </div>
      {items.length ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-success transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={item.isDone}
              disabled={readOnly || update.isPending}
              onChange={(e) =>
                update.mutate({ itemId: item.id, body: { isDone: e.target.checked } })
              }
              className="size-4 shrink-0 accent-success"
            />
            <span
              className={cn(
                'flex-1 text-[13px] text-text',
                item.isDone && 'text-text-muted line-through',
              )}
            >
              {item.text}
            </span>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => remove.mutate(item.id)}
                className="opacity-0 transition group-hover:opacity-100 hover:text-danger"
                title={t('common.delete')}
              >
                <Trash2 className="size-3.5 text-text-muted" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!readOnly ? (
        <div className="flex items-center gap-1">
          <Plus className="size-4 text-text-muted" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={t('card.addChecklistItem')}
            className="h-8"
          />
        </div>
      ) : null}
    </section>
  );
}
