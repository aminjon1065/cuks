import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Kanban, List, Search } from 'lucide-react';
import { Button, EmptyState, Input, PageHeader, Skeleton, cn, toast } from '@cuks/ui';
import type { TaskCardDto, TaskPriority } from '@cuks/shared';
import { TASK_PRIORITIES } from '@cuks/shared';
import { useMe } from '@/features/auth/api/queries';
import { BoardView } from '../components/BoardView';
import { TaskListView } from '../components/TaskListView';
import { useBoard, useCreateCard, useMoveCard, useProjectByKey } from '../api/queries';
import { useBoardRealtime } from '../hooks/useBoardRealtime';

const inputClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** «Доска проекта» (docs/modules/15 §3, task 4.2): the kanban board with drag ordering, filters,
 *  a list view, WIP limits and realtime updates. */
export function BoardPage(): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const { projectKey = '' } = useParams();
  const me = useMe();
  const project = useProjectByKey(projectKey);
  const projectId = project.data?.id;
  const board = useBoard(projectId);
  useBoardRealtime(projectId);

  const move = useMoveCard(projectId ?? '');
  const create = useCreateCard(projectId ?? '');

  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [onlyMine, setOnlyMine] = useState(false);

  const readOnly = board.data?.project.myRole === 'viewer';

  const cards = useMemo(() => {
    const all = board.data?.cards ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      if (
        q &&
        !c.title.toLowerCase().includes(q) &&
        !`${projectKey}-${c.seq}`.toLowerCase().includes(q)
      )
        return false;
      if (priority && c.priority !== priority) return false;
      if (assignee && !c.assigneeIds.includes(assignee)) return false;
      if (onlyMine && me.data && !c.assigneeIds.includes(me.data.id)) return false;
      return true;
    });
  }, [board.data?.cards, search, priority, assignee, onlyMine, me.data, projectKey]);

  const onMoveCard = (cardId: string, columnId: string, afterTaskId: string | null) =>
    move.mutate(
      { id: cardId, body: { columnId, afterTaskId } },
      { onError: () => toast({ title: t('board.moveFailed'), tone: 'danger' }) },
    );

  const onQuickAdd = (columnId: string, title: string) =>
    create.mutate(
      { columnId, title, assigneeIds: [], priority: 'p3', labels: [] },
      { onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }) },
    );

  if (project.isError) {
    return (
      <EmptyState title={t('board.notFound.title')} description={t('board.notFound.description')} />
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader
        title={project.data?.name ?? t('board.title')}
        description={project.data ? `${project.data.key}` : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            className="h-9 w-56 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('board.search')}
          />
        </div>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className={inputClass}
        >
          <option value="">{t('board.allPriorities')}</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className={inputClass}
        >
          <option value="">{t('board.allAssignees')}</option>
          {(board.data?.members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name ?? m.userId}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-text">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
          />
          {t('board.onlyMine')}
        </label>
        <div className="ml-auto flex rounded-sm border border-border p-0.5">
          <Button
            size="sm"
            variant={view === 'board' ? 'secondary' : 'ghost'}
            onClick={() => setView('board')}
          >
            <Kanban className="size-4" /> {t('board.viewBoard')}
          </Button>
          <Button
            size="sm"
            variant={view === 'list' ? 'secondary' : 'ghost'}
            onClick={() => setView('list')}
          >
            <List className="size-4" /> {t('board.viewList')}
          </Button>
        </div>
      </div>

      {board.isPending || !board.data ? (
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-72" />
          ))}
        </div>
      ) : view === 'board' ? (
        <div className="min-h-0 flex-1">
          <BoardView
            board={board.data}
            projectKey={board.data.project.key}
            readOnly={readOnly}
            cards={cards}
            allCards={board.data.cards}
            onMoveCard={onMoveCard}
            onCardClick={noop}
            onQuickAdd={onQuickAdd}
          />
        </div>
      ) : (
        <TaskListView board={board.data} cards={cards} onCardClick={noop} />
      )}
    </div>
  );
}

function noop(_card: TaskCardDto): void {
  // The card SidePanel arrives in task 4.3; a click is a no-op for now.
}
