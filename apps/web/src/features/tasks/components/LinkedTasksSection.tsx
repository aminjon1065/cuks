import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import { Button, Skeleton, cn } from '@cuks/ui';
import type { TaskLinkTarget } from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { PRIORITY_STRIPE } from '../lib/task-ui';
import { useLinkedTasks } from '../api/queries';
import { CreateTaskDialog } from './CreateTaskDialog';

/**
 * The «Задачи» panel on a ЧС / document card (docs/modules/15 §6, task 4.5): create a task linked to
 * this entity, and see the tasks already linked («связь видна с обеих сторон»). Only tasks in the
 * caller's own projects are listed.
 */
export function LinkedTasksSection({
  targetType,
  targetId,
  presetTitle,
}: {
  targetType: TaskLinkTarget;
  targetId: string;
  presetTitle?: string;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const canUse = useCan('tasks.use');
  const query = useLinkedTasks(targetType, targetId);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">{t('linked.title')}</span>
        {canUse ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t('linked.create')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-16 rounded-md" />
      ) : (query.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border py-6 text-center text-[13px] text-text-muted">
          <ListTodo className="size-5" />
          {t('linked.empty')}
        </div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-md border border-border">
          {query.data!.map((task) => (
            <li key={task.id} className="border-b border-border last:border-b-0">
              <RouterLink
                to={task.route}
                className="flex items-center gap-2 bg-surface px-3 py-2 hover:bg-surface-2"
              >
                <span
                  className={cn('h-4 w-1 shrink-0 rounded-full', PRIORITY_STRIPE[task.priority])}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px] text-text',
                    task.completedAt && 'text-text-muted line-through',
                  )}
                >
                  {task.title}
                </span>
                {task.completedAt ? <CheckCircle2 className="size-3.5 text-success" /> : null}
                <span className="shrink-0 font-mono text-xs text-text-muted">
                  {task.projectKey}-{task.seq}
                </span>
              </RouterLink>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CreateTaskDialog
          open
          onOpenChange={setCreating}
          targetType={targetType}
          targetId={targetId}
          presetTitle={presetTitle}
        />
      ) : null}
    </div>
  );
}
