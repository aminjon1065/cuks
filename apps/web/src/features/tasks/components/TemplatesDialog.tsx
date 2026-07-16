import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  cn,
  toast,
} from '@cuks/ui';
import {
  TASK_PRIORITIES,
  plainTextToTiptap,
  type ColumnDto,
  type TaskPriority,
} from '@cuks/shared';
import {
  useCreateTemplate,
  useInstantiateTemplate,
  useRemoveTemplate,
  useTemplates,
} from '../api/queries';

const inputClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-2 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** Card templates for a project (docs/modules/15 §4, task 4.5): create/delete templates and
 *  instantiate one into a column. */
export function TemplatesDialog({
  projectId,
  columns,
  onOpenChange,
}: {
  projectId: string;
  columns: ColumnDto[];
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const templates = useTemplates(projectId);
  const create = useCreateTemplate(projectId);
  const remove = useRemoveTemplate(projectId);
  const instantiate = useInstantiateTemplate(projectId);

  const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
  const fail = () => toast({ title: t('common.actionFailed'), tone: 'danger' });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('templates.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[13px]">
            <Label htmlFor="tpl-column" className="text-text-muted">
              {t('templates.intoColumn')}
            </Label>
            <select
              id="tpl-column"
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              className={inputClass}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {templates.isPending ? (
            <Skeleton className="h-20 rounded-md" />
          ) : (templates.data ?? []).length === 0 ? (
            <p className="py-2 text-center text-[13px] text-text-muted">{t('templates.empty')}</p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-md border border-border">
              {templates.data!.map((tpl) => (
                <li
                  key={tpl.id}
                  className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text">{tpl.name}</div>
                    <div className="truncate text-xs text-text-muted">
                      {tpl.title}
                      {tpl.checklist.length
                        ? ` · ${t('templates.items', { count: tpl.checklist.length })}`
                        : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={instantiate.isPending || !columnId}
                    onClick={() =>
                      instantiate.mutate(
                        { templateId: tpl.id, columnId },
                        {
                          onSuccess: () =>
                            toast({ title: t('templates.instantiated'), tone: 'success' }),
                          onError: fail,
                        },
                      )
                    }
                  >
                    {t('templates.use')}
                  </Button>
                  <button
                    type="button"
                    title={t('common.delete')}
                    onClick={() => remove.mutate(tpl.id, { onError: fail })}
                    className="hover:text-danger"
                  >
                    <Trash2 className="size-4 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <CreateTemplateForm
            onCreate={(body) => create.mutate(body, { onError: fail })}
            pending={create.isPending}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateTemplateForm({
  onCreate,
  pending,
}: {
  onCreate: (body: {
    name: string;
    title: string;
    description: unknown;
    priority: TaskPriority;
    checklist: string[];
  }) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('p3');
  const [checklist, setChecklist] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !title.trim()) return;
    const items = checklist
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onCreate({
      name: name.trim(),
      title: title.trim(),
      description: description.trim() ? plainTextToTiptap(description) : null,
      priority,
      checklist: items,
    });
    setName('');
    setTitle('');
    setDescription('');
    setChecklist('');
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-[13px] font-semibold text-text">{t('templates.new')}</span>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('templates.name')}
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className={inputClass}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('templates.cardTitle')}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder={t('templates.description')}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-surface p-2 text-[13px] text-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        )}
      />
      <textarea
        value={checklist}
        onChange={(e) => setChecklist(e.target.value)}
        rows={3}
        placeholder={t('templates.checklist')}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-surface p-2 text-[13px] text-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        )}
      />
      <Button
        type="submit"
        size="sm"
        className="self-end"
        disabled={pending || !name.trim() || !title.trim()}
      >
        <Plus className="size-4" /> {t('templates.add')}
      </Button>
    </form>
  );
}
