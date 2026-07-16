import { useTranslation } from 'react-i18next';
import {
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@cuks/ui';
import type { BoardDto, TaskCardDto } from '@cuks/shared';
import { formatDate } from '@/lib/format';
import { dueTone } from '../lib/task-ui';

/** The board's cards as a flat list (docs/modules/15 §3) — the «Список» view. */
export function TaskListView({
  board,
  cards,
  onCardClick,
}: {
  board: BoardDto;
  cards: TaskCardDto[];
  onCardClick: (card: TaskCardDto) => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const columnName = (id: string) => board.columns.find((c) => c.id === id)?.name ?? '—';
  const memberName = (id: string) => board.members.find((m) => m.userId === id)?.name ?? id;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>№</TableHead>
          <TableHead>{t('list.title')}</TableHead>
          <TableHead>{t('list.priority')}</TableHead>
          <TableHead>{t('list.column')}</TableHead>
          <TableHead>{t('list.assignees')}</TableHead>
          <TableHead>{t('list.due')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cards.map((c) => (
          <TableRow key={c.id} className="cursor-pointer" onClick={() => onCardClick(c)}>
            <TableCell className="font-mono text-xs text-text-muted">
              {board.project.key}-{c.seq}
            </TableCell>
            <TableCell className="text-text">{c.title}</TableCell>
            <TableCell className="text-[13px]">{t(`priority.${c.priority}`)}</TableCell>
            <TableCell className="text-[13px] text-text-muted">{columnName(c.columnId)}</TableCell>
            <TableCell className="text-[13px] text-text-muted">
              {c.assigneeIds.map(memberName).join(', ') || '—'}
            </TableCell>
            <TableCell>
              {c.dueAt ? (
                <StatusBadge tone={dueTone(c.dueAt, !!c.completedAt)} label={formatDate(c.dueAt)} />
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
