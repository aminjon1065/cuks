import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Trash2 } from 'lucide-react';
import { Button, Skeleton, cn } from '@cuks/ui';
import type { BoardMemberDto } from '@cuks/shared';
import { useMe } from '@/features/auth/api/queries';
import { formatRelativeTime } from '@/lib/format';
import { useAddComment, useComments, useRemoveComment } from '../api/queries';

/** Comments with @-mentions (docs/modules/15 §4). Any project viewer may comment; the composer
 *  suggests project members, and mentioned members are notified server-side. */
export function CommentsTab({
  projectId,
  cardId,
  members,
  readOnly,
}: {
  projectId: string;
  cardId: string;
  members: BoardMemberDto[];
  readOnly: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const me = useMe();
  const comments = useComments(cardId);
  const add = useAddComment(projectId, cardId);
  const remove = useRemoveComment(projectId, cardId);

  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-3">
      {!readOnly ? (
        <Composer
          members={members}
          pending={add.isPending}
          onSubmit={(b, m) => add.mutate({ body: b, mentionIds: m })}
        />
      ) : null}

      {comments.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
        </div>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">{t('card.noComments')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.data!.map((c) => (
            <li key={c.id} className="group flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-text">{c.authorName ?? c.authorId}</span>
                <span className="text-text-muted">{formatRelativeTime(c.createdAt)}</span>
                {c.authorId === me.data?.id ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(c.id)}
                    className="ml-auto opacity-0 transition group-hover:opacity-100 hover:text-danger"
                    title={t('common.delete')}
                  >
                    <Trash2 className="size-3.5 text-text-muted" />
                  </button>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-[13px] text-text">
                {highlightMentions(c.body, c.mentions, nameOf)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Render the body, tinting any `@Name` fragment that matches a mentioned member. */
function highlightMentions(
  body: string,
  mentions: string[],
  nameOf: (id: string) => string,
): React.ReactNode {
  if (mentions.length === 0) return body;
  const names = mentions.map(nameOf).filter(Boolean);
  const parts = body.split(/(@[^\n@]+)/g);
  return parts.map((part, i) =>
    part.startsWith('@') && names.some((n) => part.includes(n)) ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function Composer({
  members,
  pending,
  onSubmit,
}: {
  members: BoardMemberDto[];
  pending: boolean;
  onSubmit: (body: string, mentionIds: string[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ query: string } | null>(null);

  const options = menu
    ? members
        .filter((m) => (m.name ?? '').toLowerCase().includes(menu.query.toLowerCase()))
        .slice(0, 6)
    : [];

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setBody(text);
    const before = text.slice(0, e.target.selectionStart ?? text.length);
    const m = /@([^\s@]*)$/.exec(before);
    setMenu(m ? { query: m[1]! } : null);
  };

  const pick = (member: BoardMemberDto) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, `@${member.name ?? member.userId} `);
    const next = before + body.slice(caret);
    setBody(next);
    setMentioned((prev) => new Set(prev).add(member.userId));
    setMenu(null);
    queueMicrotask(() => el?.focus());
  };

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    // Keep only mentions whose display name still appears in the text.
    const ids = [...mentioned].filter((id) => {
      const name = members.find((m) => m.userId === id)?.name;
      return name && text.includes(name);
    });
    onSubmit(text, ids);
    setBody('');
    setMentioned(new Set());
    setMenu(null);
  };

  return (
    <div className="relative flex flex-col gap-1.5">
      <textarea
        ref={ref}
        value={body}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        rows={2}
        placeholder={t('card.commentPlaceholder')}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-surface p-2 text-[13px] text-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        )}
      />
      {menu && options.length ? (
        <div className="absolute left-2 top-full z-10 mt-0.5 w-56 rounded-md border border-border bg-surface p-1 shadow-lg">
          {options.map((m) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
            >
              {m.name ?? m.userId}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{t('card.commentHint')}</span>
        <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
          <Send className="size-3.5" /> {t('card.send')}
        </Button>
      </div>
    </div>
  );
}
