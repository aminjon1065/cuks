import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Avatar, AvatarFallback, cn } from '@cuks/ui';
import type { MessageDto } from '@cuks/shared';
import { formatTime } from '@/lib/format';
import { initials } from '../lib/grouping';
import { renderMessageBody } from '../lib/renderMessage';

/** A single message row. `showAuthor` starts a new author-run (avatar + name + time header); otherwise
 *  the body is indented under the previous message (docs/modules/13 §7). Optimistic rows (temp id)
 *  render muted with a "sending" clock until the server row reconciles. */
export function MessageItem({
  message,
  showAuthor,
}: {
  message: MessageDto;
  showAuthor: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const pending = message.id.startsWith('temp-');

  if (message.kind === 'system') {
    return (
      <div className="py-1 text-center text-xs text-text-muted">
        {message.bodyText ?? t('message.system')}
      </div>
    );
  }

  const body = message.deletedAt ? (
    <span className="text-[13px] italic text-text-muted">{t('message.deleted')}</span>
  ) : (
    <div className="chat-message-body text-[14px] leading-relaxed text-text">
      {renderMessageBody(message.body)}
    </div>
  );

  return (
    <div
      className={cn('flex gap-2.5 px-4', showAuthor ? 'pt-3' : 'pt-0.5', pending && 'opacity-60')}
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
        {body}
      </div>
    </div>
  );
}
