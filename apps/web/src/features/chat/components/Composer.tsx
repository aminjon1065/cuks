import { useCallback, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { Bold, Code, Italic, Link2, List, ListOrdered, SendHorizontal, X } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn, toast } from '@cuks/ui';
import type { ChatMemberDto, MessageDto } from '@cuks/shared';
import { useSocket } from '@/lib/socket';
import { useSendMessage } from '../api/queries';
import { makeMentionSuggestion } from './mentionSuggestion';
import type { MentionItem } from './MentionList';

/** Typing hints are re-emitted at most this often while the user types (docs/modules/13 §4). */
const TYPING_THROTTLE_MS = 3_000;

/** Rich-text message composer (docs/modules/13 §5): TipTap with bold/italic/code/lists/links,
 *  `@`-mentions of channel members, Enter-to-send / Shift+Enter for a newline, optimistic send, and
 *  an optional reply banner (docs/modules/13 §4). */
export function Composer({
  channelId,
  members,
  me,
  replyingTo,
  onCancelReply,
}: {
  channelId: string;
  members: ChatMemberDto[];
  me: { id: string; name: string | null };
  replyingTo: MessageDto | null;
  onCancelReply: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const send = useSendMessage(channelId, me);
  const { socket } = useSocket();

  const replyToRef = useRef<MessageDto | null>(replyingTo);
  replyToRef.current = replyingTo;

  const membersRef = useRef<MentionItem[]>([]);
  membersRef.current = members.map((m) => ({ id: m.userId, label: m.name ?? m.userId }));
  const mentionOpenRef = useRef(false);
  const submitRef = useRef<() => void>(() => {});
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // Typing hint (docs/modules/13 §4): at most one channel.typing per 3s while the user edits. Refs,
  // because the editor (and its onUpdate closure) is created once per channel mount.
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const lastTypingRef = useRef(0);
  const emitTyping = (): void => {
    const s = socketRef.current;
    const now = Date.now();
    if (!s || now - lastTypingRef.current < TYPING_THROTTLE_MS) return;
    lastTypingRef.current = now;
    // channel.typing is a client→server message, outside the server-event map.
    (s as unknown as { emit: (e: string, p: unknown) => void }).emit('channel.typing', {
      channelId,
    });
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: t('composer.placeholder') }),
      Mention.configure({
        HTMLAttributes: { class: 'chat-mention' },
        suggestion: makeMentionSuggestion(
          () => membersRef.current,
          (open) => {
            mentionOpenRef.current = open;
          },
          t('composer.mentionEmpty'),
        ),
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'chat-composer max-h-40 min-h-[2.25rem] overflow-y-auto px-3 py-2 text-[14px] text-text',
        role: 'textbox',
        'aria-label': t('composer.placeholder'),
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !mentionOpenRef.current) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (!e.isEmpty) emitTyping();
      forceRender();
    },
    onSelectionUpdate: () => forceRender(),
  });

  const onCancelReplyRef = useRef(onCancelReply);
  onCancelReplyRef.current = onCancelReply;
  const submit = useCallback(() => {
    if (!editor || editor.isEmpty) return;
    const body = editor.getJSON();
    const replyToId = replyToRef.current?.id;
    send.mutate(
      { kind: 'text', body, fileIds: [], ...(replyToId ? { replyToId } : {}) },
      { onError: () => toast({ title: t('composer.sendFailed'), tone: 'danger' }) },
    );
    editor.commands.clearContent(true);
    editor.commands.focus();
    onCancelReplyRef.current();
  }, [editor, send, t]);
  submitRef.current = submit;

  const empty = !editor || editor.isEmpty;

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = window.prompt(t('composer.linkPrompt'), prev);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor, t]);

  return (
    <div className="border-t border-border p-3">
      {replyingTo ? (
        <div className="mb-1 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs">
          <span className="shrink-0 text-text-muted">{t('message.replyingTo')}</span>
          <span className="font-medium text-text">{replyingTo.authorName ?? '—'}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted">{replyingTo.bodyText}</span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={t('common.cancel')}
            className="shrink-0 rounded-sm p-0.5 text-text-muted hover:bg-surface hover:text-text"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-surface focus-within:ring-2 focus-within:ring-primary/40">
        <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
          <ToolbarButton
            label={t('composer.bold')}
            active={editor?.isActive('bold')}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('composer.italic')}
            active={editor?.isActive('italic')}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('composer.code')}
            active={editor?.isActive('code')}
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            <Code className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('composer.bulletList')}
            active={editor?.isActive('bulletList')}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('composer.orderedList')}
            active={editor?.isActive('orderedList')}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('composer.link')}
            active={editor?.isActive('link')}
            onClick={setLink}
          >
            <Link2 className="size-4" />
          </ToolbarButton>
        </div>

        <div className="flex items-end gap-2 p-1">
          <div className="min-w-0 flex-1">
            <EditorContent editor={editor} />
          </div>
          <Button
            size="icon"
            className="mb-1 mr-1 shrink-0"
            onClick={submit}
            disabled={empty}
            aria-label={t('composer.send')}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
      <p className="mt-1 px-1 text-[11px] text-text-muted">{t('composer.hint')}</p>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean | undefined;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active ? 'true' : 'false'}
          className={cn(
            'flex size-7 items-center justify-center rounded-sm transition-colors',
            active
              ? 'bg-primary/10 text-primary'
              : 'text-text-muted hover:bg-surface-2 hover:text-text',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
