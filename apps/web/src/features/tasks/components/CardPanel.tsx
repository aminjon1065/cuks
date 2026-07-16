import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Copy, Eye, EyeOff } from 'lucide-react';
import { Button, SidePanel, Skeleton, cn, toast } from '@cuks/ui';
import {
  TASK_PRIORITIES,
  plainTextToTiptap,
  tiptapToText,
  type BoardDto,
  type TaskCardDetailDto,
  type TaskLabelColor,
} from '@cuks/shared';
import { useMe } from '@/features/auth/api/queries';
import {
  cardKey,
  useArchiveCard,
  useCardDetail,
  useCompleteCard,
  useCopyCard,
  useCreateLabel,
  useEditCard,
  useMoveCard,
  useSetWatching,
} from '../api/queries';
import { useCardRealtime } from '../hooks/useCardRealtime';
import { AssigneePicker } from './AssigneePicker';
import { LabelEditor } from './LabelEditor';
import { ChecklistSection } from './ChecklistSection';
import { CommentsTab } from './CommentsTab';
import { HistoryTab } from './HistoryTab';
import { DateTimeField } from './DateTimeField';

const selectClass = cn(
  'h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60',
);

/** The card SidePanel over the board (docs/modules/15 §4, task 4.3). Non-modal so the board stays
 *  interactive; all fields save on change/blur; comments and watch are open to any member. */
export function CardPanel({
  board,
  cardId,
  onClose,
}: {
  board: BoardDto;
  cardId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const me = useMe();
  const qc = useQueryClient();
  const projectId = board.project.id;
  const detail = useCardDetail(cardId);
  const card = detail.data;
  useCardRealtime(cardId);

  const edit = useEditCard(projectId, cardId);
  const move = useMoveCard(projectId);
  const complete = useCompleteCard(projectId, cardId);
  const copy = useCopyCard(projectId);
  const archive = useArchiveCard(projectId);
  const watch = useSetWatching(projectId, cardId);
  const createLabel = useCreateLabel(projectId);

  const myRole = board.project.myRole;
  const canEdit = myRole === 'editor' || myRole === 'owner';
  const isMember = myRole !== null;
  const [tab, setTab] = useState<'comments' | 'history'>('comments');

  const fail = () => toast({ title: t('common.actionFailed'), tone: 'danger' });
  const save = (body: Parameters<typeof edit.mutate>[0]) => edit.mutate(body, { onError: fail });

  const watching = !!(me.data && card?.watcherIds.includes(me.data.id));

  const onCreateLabel = (name: string, color: TaskLabelColor) =>
    createLabel.mutate(
      { name, color },
      {
        onSuccess: (label) => {
          // Read the freshest labels from the cache (not a stale render closure) before appending.
          const current = qc.getQueryData<TaskCardDetailDto>(cardKey(cardId))?.labels ?? [];
          save({ labels: [...current, label.id] });
        },
        onError: fail,
      },
    );

  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      modal={false}
      title={
        <span className="font-mono text-xs text-text-muted">
          {board.project.key}-{card?.seq ?? ''}
        </span>
      }
      footer={
        canEdit || isMember ? (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button size="sm" onClick={() => complete.mutate(undefined, { onError: fail })}>
                <Check className="size-4" /> {t('card.complete')}
              </Button>
            ) : null}
            {isMember ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => watch.mutate(!watching, { onError: fail })}
              >
                {watching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {watching ? t('card.unwatch') : t('card.watch')}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  copy.mutate(cardId, {
                    onSuccess: () => toast({ title: t('card.copied'), tone: 'success' }),
                    onError: fail,
                  })
                }
              >
                <Copy className="size-4" /> {t('card.copy')}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => archive.mutate(cardId, { onSuccess: onClose, onError: fail })}
              >
                <Archive className="size-4" /> {t('card.archive')}
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {detail.isPending || !card ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 rounded-md" />
          <Skeleton className="h-24 rounded-md" />
          <Skeleton className="h-32 rounded-md" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <TitleField value={card.title} disabled={!canEdit} onSave={(title) => save({ title })} />

          <div className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2.5 text-[13px]">
            <FieldLabel>{t('card.field.status')}</FieldLabel>
            <select
              value={card.columnId}
              disabled={!canEdit}
              onChange={(e) =>
                move.mutate(
                  { id: cardId, body: { columnId: e.target.value, afterTaskId: null } },
                  { onError: fail },
                )
              }
              className={selectClass}
            >
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <FieldLabel>{t('card.field.priority')}</FieldLabel>
            <select
              value={card.priority}
              disabled={!canEdit}
              onChange={(e) =>
                save({ priority: e.target.value as (typeof TASK_PRIORITIES)[number] })
              }
              className={selectClass}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>

            <FieldLabel>{t('card.field.dueAt')}</FieldLabel>
            <DateTimeField
              value={card.dueAt}
              disabled={!canEdit}
              onChange={(dueAt) => save({ dueAt })}
            />

            <FieldLabel>{t('card.field.assignees')}</FieldLabel>
            <AssigneePicker
              members={board.members}
              value={card.assigneeIds}
              disabled={!canEdit}
              onChange={(assigneeIds) => save({ assigneeIds })}
            />

            <FieldLabel>{t('card.field.labels')}</FieldLabel>
            <LabelEditor
              labels={board.labels}
              value={card.labels}
              disabled={!canEdit}
              onChange={(labels) => save({ labels })}
              onCreate={onCreateLabel}
            />
          </div>

          <DescriptionField
            value={tiptapToText(card.description)}
            disabled={!canEdit}
            onSave={(text) => save({ description: text.trim() ? plainTextToTiptap(text) : null })}
          />

          <ChecklistSection
            projectId={projectId}
            cardId={cardId}
            items={card.checklist}
            readOnly={!canEdit}
          />

          <div className="flex flex-col gap-2">
            <div className="flex gap-1 border-b border-border">
              <Tab active={tab === 'comments'} onClick={() => setTab('comments')}>
                {t('card.tabComments')} ({card.commentCount})
              </Tab>
              <Tab active={tab === 'history'} onClick={() => setTab('history')}>
                {t('card.tabHistory')}
              </Tab>
            </div>
            {tab === 'comments' ? (
              <CommentsTab
                projectId={projectId}
                cardId={cardId}
                members={board.members}
                readOnly={!isMember}
              />
            ) : (
              <HistoryTab cardId={cardId} />
            )}
          </div>
        </div>
      )}
    </SidePanel>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-text-muted">{children}</span>;
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-2 py-1.5 text-[13px]',
        active
          ? 'border-primary font-medium text-text'
          : 'border-transparent text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function TitleField({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (v: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (next && next !== value) onSave(next);
    else setText(value);
  };
  return (
    <textarea
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      rows={1}
      className={cn(
        'w-full resize-none rounded-sm bg-transparent text-lg font-semibold text-text',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-100',
      )}
    />
  );
}

function DescriptionField({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (v: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-text">{t('card.field.description')}</span>
      <textarea
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onSave(text)}
        rows={4}
        placeholder={disabled ? t('card.noDescription') : t('card.descriptionPlaceholder')}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-surface p-2 text-[13px] text-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-80',
        )}
      />
    </div>
  );
}
