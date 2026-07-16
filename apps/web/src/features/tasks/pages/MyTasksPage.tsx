import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, FolderKanban, ListTodo } from 'lucide-react';
import { Button, EmptyState, PageHeader, Skeleton, StatusBadge, cn, toast } from '@cuks/ui';
import { TASK_DUE_BUCKETS, taskDueBucket, type MyTaskDto } from '@cuks/shared';
import { formatDate } from '@/lib/format';
import { PRIORITY_STRIPE, dueTone } from '../lib/task-ui';
import { useMyTasks, useQuickComplete } from '../api/queries';

/** «Мои задачи» (docs/modules/15 §5, task 4.4): every open task assigned to me across all projects,
 *  grouped by due proximity, with a quick-complete checkbox and a «где я наблюдатель» filter. */
export function MyTasksPage(): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();
  const [watching, setWatching] = useState(false);
  const query = useMyTasks(watching);
  const complete = useQuickComplete();

  const groups = useMemo(() => {
    const now = new Date();
    const all = query.data ?? [];
    return TASK_DUE_BUCKETS.map((bucket) => ({
      bucket,
      items: all.filter((task) => taskDueBucket(task.dueAt, now) === bucket),
    })).filter((g) => g.items.length > 0);
  }, [query.data]);

  const open = (task: MyTaskDto) => navigate(`/app/tasks/projects/${task.projectKey}/${task.seq}`);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('my.title')}
        description={t('my.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[13px] text-text">
              <input
                type="checkbox"
                checked={watching}
                onChange={(e) => setWatching(e.target.checked)}
              />
              {t('my.watching')}
            </label>
            <Button variant="outline" size="sm" onClick={() => navigate('/app/tasks/projects')}>
              <FolderKanban className="size-4" /> {t('my.projects')}
            </Button>
          </div>
        }
      />

      {query.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-md" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={t('my.empty.title')}
          description={watching ? t('my.empty.watching') : t('my.empty.description')}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.bucket} className="flex flex-col gap-1">
              <h2 className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t(`my.bucket.${group.bucket}`)}
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-normal">
                  {group.items.length}
                </span>
              </h2>
              <ul className="overflow-hidden rounded-lg border border-border">
                {group.items.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2 last:border-b-0 hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={complete.isPending}
                      title={t('my.complete')}
                      onChange={() =>
                        complete.mutate(
                          { id: task.id, projectId: task.projectId },
                          {
                            onError: () =>
                              toast({ title: t('common.actionFailed'), tone: 'danger' }),
                          },
                        )
                      }
                      className="size-4 shrink-0 accent-success"
                    />
                    <span
                      className={cn(
                        'h-4 w-1 shrink-0 rounded-full',
                        PRIORITY_STRIPE[task.priority],
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => open(task)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="truncate text-[13px] text-text">{task.title}</span>
                      <span className="shrink-0 font-mono text-xs text-text-muted">
                        {task.projectKey}-{task.seq}
                      </span>
                    </button>
                    {task.dueAt ? (
                      <StatusBadge
                        tone={dueTone(task.dueAt, false)}
                        label={
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-3" /> {formatDate(task.dueAt)}
                          </span>
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
