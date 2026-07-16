import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ListTodo } from 'lucide-react';
import { Skeleton, StatusBadge, cn } from '@cuks/ui';
import { formatDate } from '@/lib/format';
import { PRIORITY_STRIPE, dueTone } from '../lib/task-ui';
import { useMyTasks } from '../api/queries';

/** Dashboard «Мои задачи» widget (docs/modules/15 §5, task 4.4): the top-5 of the personal queue. */
export function MyTasksWidget(): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();
  const query = useMyTasks(false);
  const top = (query.data ?? []).slice(0, 5);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 rounded-md" />
        ))}
      </div>
    );
  }
  if (top.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-6 text-center text-[13px] text-text-muted">
        <ListTodo className="size-5" />
        {t('my.empty.title')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {top.map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={() => navigate(`/app/tasks/projects/${task.projectKey}/${task.seq}`)}
          className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2"
        >
          <span className={cn('h-4 w-1 shrink-0 rounded-full', PRIORITY_STRIPE[task.priority])} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-text">{task.title}</span>
          {task.dueAt ? (
            <StatusBadge tone={dueTone(task.dueAt, false)} label={formatDate(task.dueAt)} />
          ) : null}
        </button>
      ))}
      <button
        type="button"
        onClick={() => navigate('/app/tasks')}
        className="mt-1 flex items-center gap-1 self-start px-1.5 text-xs text-primary hover:underline"
      >
        {t('my.viewAll')} <ArrowRight className="size-3" />
      </button>
    </div>
  );
}
