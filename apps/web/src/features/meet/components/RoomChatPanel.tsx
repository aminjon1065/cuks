import { useTranslation } from 'react-i18next';
import { Chat } from '@livekit/components-react';
import { X } from 'lucide-react';

/** Ephemeral in-call chat (docs/modules/14 §3): the LiveKit data-channel chat, not persisted. */
export function RoomChatPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation('meet');
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-border bg-surface-1"
      data-lk-theme="default"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">{t('room.chat')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('cancel')}
          className="text-text-muted hover:text-text"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="meet-chat min-h-0 flex-1">
        <Chat />
      </div>
    </aside>
  );
}
