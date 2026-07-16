import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Tag } from 'lucide-react';
import { Input, Popover, PopoverContent, PopoverTrigger, cn } from '@cuks/ui';
import { TASK_LABEL_COLORS, type LabelDto, type TaskLabelColor } from '@cuks/shared';
import { labelDot } from '../lib/task-ui';

/** Assign existing project labels to the card and create new ones (docs/modules/15 §2/§4). */
export function LabelEditor({
  labels,
  value,
  onChange,
  onCreate,
  disabled,
}: {
  labels: LabelDto[];
  value: string[];
  onChange: (ids: string[]) => void;
  onCreate: (name: string, color: TaskLabelColor) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<TaskLabelColor>('blue');
  const selected = labels.filter((l) => value.includes(l.id));

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const create = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), color);
    setName('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.map((l) => (
        <span
          key={l.id}
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text"
        >
          <span className={cn('size-2 rounded-full', labelDot(l.color))} />
          {l.name}
        </span>
      ))}
      {!disabled ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-muted hover:border-primary/50 hover:text-text"
            >
              <Tag className="size-3" /> {t('card.labels')}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="start">
            <div className="max-h-48 overflow-y-auto">
              {labels.length === 0 ? (
                <p className="px-2 py-2 text-center text-xs text-text-muted">
                  {t('card.noLabels')}
                </p>
              ) : (
                labels.map((l) => {
                  const on = value.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggle(l.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                        on && 'text-primary',
                      )}
                    >
                      <span className={cn('size-2.5 rounded-full', labelDot(l.color))} />
                      <span className="flex-1 truncate">{l.name}</span>
                      {on ? <Check className="size-3.5" /> : null}
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-1 flex items-center gap-1 border-t border-border pt-1">
              <div className="flex gap-0.5">
                {TASK_LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'size-4 rounded-full',
                      labelDot(c),
                      color === c ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface' : '',
                    )}
                    aria-label={c}
                  />
                ))}
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder={t('card.newLabel')}
                className="h-7 flex-1"
              />
              <button
                type="button"
                onClick={create}
                disabled={!name.trim()}
                className="grid size-7 place-items-center rounded-sm text-primary hover:bg-surface-2 disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
