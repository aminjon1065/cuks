import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  cn,
  toast,
} from '@cuks/ui';
import type { TaskLinkTarget } from '@cuks/shared';
import { AssigneePicker } from './AssigneePicker';
import { DateTimeField } from './DateTimeField';
import { useBoard, useCreateLinkedCard, useProjects } from '../api/queries';

const inputClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-2 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

const DEFAULT_PROJECT_NAME = 'Оперативные поручения';

/**
 * «Создать задачу» from a ЧС or document (docs/modules/15 §6, task 4.5). A mini-form — project,
 * column, title, assignees, due — that creates a card already linked to the source entity. Defaults
 * to the «Оперативные поручения» project when the caller belongs to it.
 */
export function CreateTaskDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  presetTitle,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: TaskLinkTarget;
  targetId: string;
  presetTitle?: string | undefined;
  onCreated?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const projects = useProjects();
  const create = useCreateLinkedCard();

  const [projectId, setProjectId] = useState('');
  const [columnId, setColumnId] = useState('');
  const [title, setTitle] = useState(presetTitle ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState<string | null>(null);

  // Projects the caller can create cards in (editor/owner). Default to «Оперативные поручения».
  const editable = useMemo(
    () => (projects.data ?? []).filter((p) => p.myRole === 'editor' || p.myRole === 'owner'),
    [projects.data],
  );
  useEffect(() => {
    if (projectId || editable.length === 0) return;
    setProjectId((editable.find((p) => p.name === DEFAULT_PROJECT_NAME) ?? editable[0]!).id);
  }, [editable, projectId]);
  useEffect(() => setTitle(presetTitle ?? ''), [presetTitle]);

  // Clear the column when the project changes so a stale column from the previous board is never
  // submitted while the new board is still loading (submit is gated on columnId).
  useEffect(() => setColumnId(''), [projectId]);
  const board = useBoard(projectId || undefined);
  useEffect(() => {
    const columns = board.data?.columns ?? [];
    if (columns.length && !columns.some((c) => c.id === columnId)) setColumnId(columns[0]!.id);
  }, [board.data?.columns, columnId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !columnId || !title.trim()) return;
    create.mutate(
      { projectId, columnId, title: title.trim(), assigneeIds, dueAt, targetType, targetId },
      {
        onSuccess: () => {
          toast({ title: t('createTask.created'), tone: 'success' });
          onCreated?.();
          onOpenChange(false);
        },
        onError: () => toast({ title: t('createTask.failed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createTask.title')}</DialogTitle>
        </DialogHeader>
        {projects.isPending ? (
          <Skeleton className="h-40 rounded-md" />
        ) : editable.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">{t('createTask.noProjects')}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="ct-project">{t('createTask.project')}</Label>
                <select
                  id="ct-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className={inputClass}
                >
                  {editable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ct-column">{t('createTask.column')}</Label>
                <select
                  id="ct-column"
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  className={inputClass}
                  disabled={board.isPending}
                >
                  {(board.data?.columns ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ct-title">{t('createTask.taskTitle')}</Label>
              <Input
                id="ct-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t('createTask.assignees')}</Label>
              <AssigneePicker
                members={board.data?.members ?? []}
                value={assigneeIds}
                onChange={setAssigneeIds}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t('createTask.due')}</Label>
              <DateTimeField value={dueAt} onChange={setDueAt} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || !title.trim() || !columnId}>
                {t('createTask.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
