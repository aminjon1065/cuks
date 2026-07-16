import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { Input, cn } from '@cuks/ui';
import type { BoardDto, TaskCardDto } from '@cuks/shared';
import { TaskCardView } from './TaskCardView';

type CardsByColumn = Record<string, string[]>;

/** The kanban board with dnd-kit drag (docs/modules/15 §3). Cards drag within and between
 *  columns; only the moved card's fractional key is rewritten on drop. WIP-exceeded columns are
 *  highlighted. Read-only for viewers (no drag, no quick-add). */
export function BoardView({
  board,
  projectKey,
  readOnly,
  cards,
  allCards,
  onMoveCard,
  onCardClick,
  onQuickAdd,
}: {
  board: BoardDto;
  projectKey: string;
  readOnly: boolean;
  /** The cards to render — may be a filtered subset of the board. */
  cards: TaskCardDto[];
  /** The full, server-ordered card set — used to resolve drop positions against hidden cards. */
  allCards: TaskCardDto[];
  onMoveCard: (cardId: string, columnId: string, afterTaskId: string | null) => void;
  onCardClick: (card: TaskCardDto) => void;
  onQuickAdd: (columnId: string, title: string) => void;
}): React.JSX.Element {
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const visibleIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);

  // The full server order per column (allCards arrives sorted by order key within each column).
  const fullOrder = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of board.columns) map[col.id] = [];
    for (const c of allCards) (map[c.columnId] ??= []).push(c.id);
    return map;
  }, [board.columns, allCards]);
  const currentColumnOf = useMemo(
    () => new Map(allCards.map((c) => [c.id, c.columnId])),
    [allCards],
  );

  /**
   * Translate a drop in the (possibly filtered) visible list into an afterTaskId against the FULL
   * order, so a card never leapfrogs cards hidden by a filter. Dropping below a visible card keeps
   * that card as the anchor; dropping at the visible top anchors on the full-order card just above
   * the first visible one (or null only when it is truly the column's first card).
   */
  const resolveAfterTaskId = (
    columnId: string,
    movedId: string,
    visibleList: string[],
  ): string | null => {
    const pos = visibleList.indexOf(movedId);
    if (pos > 0) return visibleList[pos - 1]!;
    const full = (fullOrder[columnId] ?? []).filter((id) => id !== movedId);
    const firstVisible = full.findIndex((id) => visibleIds.has(id));
    if (firstVisible === -1) return full.length ? full[full.length - 1]! : null;
    if (firstVisible === 0) return null;
    return full[firstVisible - 1]!;
  };

  // Local per-column ordering, resynced from the server board when not mid-drag.
  const serverItems = useMemo<CardsByColumn>(() => {
    const map: CardsByColumn = {};
    for (const col of board.columns) map[col.id] = [];
    for (const c of cards) (map[c.columnId] ??= []).push(c.id);
    return map;
  }, [board.columns, cards]);

  const [items, setItems] = useState<CardsByColumn>(serverItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setItems(serverItems);
  }, [serverItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (id: string): string | undefined => {
    if (items[id]) return id; // a column id
    return board.columns.find((c) => items[c.id]?.includes(id))?.id;
  };

  const onDragStart = (e: DragStartEvent) => {
    dragging.current = true;
    setActiveId(String(e.active.id));
  };

  const onDragOver = (e: DragOverEvent) => {
    const activeCol = columnOf(String(e.active.id));
    const overCol = columnOf(String(e.over?.id ?? ''));
    if (!activeCol || !overCol || activeCol === overCol) return;
    setItems((prev) => {
      const from = prev[activeCol]!.filter((id) => id !== e.active.id);
      const to = [...prev[overCol]!];
      const overIdx = to.indexOf(String(e.over?.id));
      to.splice(overIdx >= 0 ? overIdx : to.length, 0, String(e.active.id));
      return { ...prev, [activeCol]: from, [overCol]: to };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    dragging.current = false;
    setActiveId(null);
    const movedId = String(e.active.id);
    const activeCol = columnOf(movedId);
    const overCol = columnOf(String(e.over?.id ?? ''));
    if (!activeCol || !overCol) {
      setItems(serverItems);
      return;
    }
    let next = items;
    if (activeCol === overCol) {
      const list = items[activeCol]!;
      const oldIdx = list.indexOf(movedId);
      const overIdx = list.indexOf(String(e.over?.id));
      if (oldIdx !== overIdx && overIdx >= 0) {
        next = { ...items, [activeCol]: arrayMove(list, oldIdx, overIdx) };
        setItems(next);
      }
    }
    const afterTaskId = resolveAfterTaskId(overCol, movedId, next[overCol]!);

    // Skip a drop that lands exactly where the card already sits — no server write, no broadcast.
    const srcCol = currentColumnOf.get(movedId);
    const srcOrder = fullOrder[srcCol ?? ''] ?? [];
    const srcIdx = srcOrder.indexOf(movedId);
    const srcAfter = srcIdx > 0 ? srcOrder[srcIdx - 1]! : null;
    if (overCol === srcCol && afterTaskId === srcAfter) {
      setItems(serverItems);
      return;
    }
    onMoveCard(movedId, overCol, afterTaskId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        dragging.current = false;
        setActiveId(null);
        setItems(serverItems);
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto pb-3">
        {board.columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            cardIds={items[col.id] ?? []}
            cardsById={cardsById}
            projectKey={projectKey}
            board={board}
            readOnly={readOnly}
            onCardClick={onCardClick}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>
      <DragOverlay>
        {activeId && cardsById.get(activeId) ? (
          <div className="w-64 rotate-1 opacity-90">
            <TaskCardView
              card={cardsById.get(activeId)!}
              projectKey={projectKey}
              members={board.members}
              labels={board.labels}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  cardIds,
  cardsById,
  projectKey,
  board,
  readOnly,
  onCardClick,
  onQuickAdd,
}: {
  column: BoardDto['columns'][number];
  cardIds: string[];
  cardsById: Map<string, TaskCardDto>;
  projectKey: string;
  board: BoardDto;
  readOnly: boolean;
  onCardClick: (card: TaskCardDto) => void;
  onQuickAdd: (columnId: string, title: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const overWip = column.wipLimit != null && cardIds.length > column.wipLimit;
  const { setNodeRef } = useSortableColumn(column.id);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex max-h-full w-72 shrink-0 flex-col rounded-lg border bg-surface-2/40 p-2',
        overWip ? 'border-warning' : 'border-border',
      )}
    >
      <header className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-text">
        <span>{column.name}</span>
        <span className={cn('text-xs font-normal', overWip ? 'text-warning' : 'text-text-muted')}>
          {cardIds.length}
          {column.wipLimit != null ? `/${column.wipLimit}` : ''}
        </span>
      </header>
      <div className="flex min-h-4 flex-1 flex-col gap-2 overflow-y-auto">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cardIds.map((id) => {
            const card = cardsById.get(id);
            if (!card) return null;
            return (
              <SortableCard
                key={id}
                card={card}
                projectKey={projectKey}
                board={board}
                readOnly={readOnly}
                onClick={() => onCardClick(card)}
              />
            );
          })}
        </SortableContext>
      </div>
      {!readOnly ? <QuickAdd onAdd={(title) => onQuickAdd(column.id, title)} t={t} /> : null}
    </section>
  );
}

/** A column is itself a droppable target (so a card can be dropped into an empty column). */
function useSortableColumn(id: string) {
  const { setNodeRef } = useSortable({ id, data: { type: 'column' } });
  return { setNodeRef };
}

function SortableCard({
  card,
  projectKey,
  board,
  readOnly,
  onClick,
}: {
  card: TaskCardDto;
  projectKey: string;
  board: BoardDto;
  readOnly: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: readOnly,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('cursor-pointer', isDragging && 'opacity-40')}
      onClick={onClick}
      {...(readOnly ? {} : attributes)}
      {...(readOnly ? {} : listeners)}
    >
      <TaskCardView
        card={card}
        projectKey={projectKey}
        members={board.members}
        labels={board.labels}
      />
    </div>
  );
}

function QuickAdd({
  onAdd,
  t,
}: {
  onAdd: (title: string) => void;
  t: (k: string) => string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
      >
        <Plus className="size-3.5" /> {t('board.addCard')}
      </button>
    );
  }
  const submit = () => {
    if (title.trim()) onAdd(title.trim());
    setTitle('');
    setOpen(false);
  };
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={submit}
        placeholder={t('board.cardTitle')}
      />
    </div>
  );
}
