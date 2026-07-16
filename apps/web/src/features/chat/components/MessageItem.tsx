import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  CornerUpLeft,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  toast,
} from '@cuks/ui';
import type { ChatMemberDto, MessageDto } from '@cuks/shared';
import { formatTime } from '@/lib/format';
import {
  useDeleteMessage,
  useEditMessage,
  usePinMessage,
  useToggleReaction,
  useUnpinMessage,
} from '../api/queries';
import { initials } from '../lib/grouping';
import { renderMessageBody } from '../lib/renderMessage';
import { EmojiPicker } from './EmojiPicker';
import { InlineEditor } from './InlineEditor';

/** How long after posting the author may still edit (docs/modules/13 §4). */
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A single message row: reply quote, body (or tombstone), reaction chips and a hover action bar
 *  (react / reply / edit / delete / pin) — docs/modules/13 §4. */
export function MessageItem({
  message,
  showAuthor,
  meId,
  members,
  canModerate,
  pinned,
  onReply,
}: {
  message: MessageDto;
  showAuthor: boolean;
  meId: string;
  members: ChatMemberDto[];
  canModerate: boolean;
  pinned: boolean;
  onReply: (m: MessageDto) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const pending = message.id.startsWith('temp-');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const react = useToggleReaction(message.channelId);
  const edit = useEditMessage(message.channelId);
  const del = useDeleteMessage(message.channelId);
  const pin = usePinMessage(message.channelId);
  const unpin = useUnpinMessage(message.channelId);

  if (message.kind === 'system') {
    return (
      <div className="py-1 text-center text-xs text-text-muted">
        {message.bodyText ?? t('message.system')}
      </div>
    );
  }

  const isAuthor = message.authorId === meId && !pending;
  const editable =
    isAuthor &&
    message.kind === 'text' &&
    Date.now() - Date.parse(message.createdAt) < EDIT_WINDOW_MS;
  const deletable = (isAuthor || canModerate) && !pending;
  const deleted = !!message.deletedAt;

  const doReact = (emoji: string): void => react.mutate({ id: message.id, emoji });
  const doEdit = (body: unknown): void =>
    edit.mutate(
      { id: message.id, body },
      {
        onSuccess: () => setEditing(false),
        onError: () => toast({ title: t('message.editFailed'), tone: 'danger' }),
      },
    );
  const doDelete = (): void =>
    del.mutate(message.id, {
      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
    });

  return (
    <div
      className={cn(
        'group relative flex gap-2.5 px-4',
        showAuthor ? 'pt-3' : 'pt-0.5',
        pending && 'opacity-60',
        'hover:bg-surface-2/40',
      )}
    >
      <div className="w-9 shrink-0">
        {showAuthor ? (
          <Avatar className="size-9">
            <AvatarFallback>{initials(message.authorName)}</AvatarFallback>
          </Avatar>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {showAuthor ? (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-text">{message.authorName ?? '—'}</span>
            <span className="flex items-center gap-1 text-[11px] text-text-muted">
              {pending ? <Clock className="size-3" /> : formatTime(message.createdAt)}
            </span>
          </div>
        ) : null}

        {message.replyTo ? (
          <div className="mb-0.5 flex items-center gap-1.5 border-l-2 border-border pl-2 text-xs text-text-muted">
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="font-medium text-text">{message.replyTo.authorName ?? '—'}</span>
            <span className="truncate">
              {message.replyTo.deleted ? t('message.deleted') : message.replyTo.bodyText}
            </span>
          </div>
        ) : null}

        {deleted ? (
          <span className="text-[13px] italic text-text-muted">{t('message.deleted')}</span>
        ) : editing ? (
          <InlineEditor
            body={message.body}
            members={members}
            pending={edit.isPending}
            onSave={doEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="chat-message-body text-[14px] leading-relaxed text-text">
            {renderMessageBody(message.body)}
            {message.editedAt ? (
              <span className="ml-1 text-[11px] text-text-muted">({t('message.edited')})</span>
            ) : null}
          </div>
        )}

        {!deleted && message.reactions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => doReact(r.emoji)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
                  r.mine
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <span>{r.emoji}</span>
                <span className="tabular-nums">{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!deleted && !pending && !editing ? (
        <div className="absolute right-3 top-1 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 opacity-0 shadow-sm transition group-hover:opacity-100">
          <EmojiPicker
            align="end"
            onPick={doReact}
            trigger={
              <button
                type="button"
                aria-label={t('message.react')}
                className="flex size-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <SmilePlus className="size-4" />
              </button>
            }
          />
          <button
            type="button"
            onClick={() => onReply(message)}
            aria-label={t('message.reply')}
            className="flex size-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CornerUpLeft className="size-4" />
          </button>
          {editable || deletable || canModerate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('message.more')}
                  className="flex size-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {editable ? (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="size-4" /> {t('message.edit')}
                  </DropdownMenuItem>
                ) : null}
                {canModerate ? (
                  pinned ? (
                    <DropdownMenuItem onSelect={() => unpin.mutate(message.id)}>
                      <PinOff className="size-4" /> {t('message.unpin')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => pin.mutate(message.id)}>
                      <Pin className="size-4" /> {t('message.pin')}
                    </DropdownMenuItem>
                  )
                ) : null}
                {deletable ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-danger"
                      onSelect={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="size-4" /> {t('common.delete')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirmDelete}
          title={t('message.deleteConfirmTitle')}
          description={t('message.deleteConfirmBody')}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          loading={del.isPending}
          onConfirm={doDelete}
        />
      ) : null}
    </div>
  );
}
