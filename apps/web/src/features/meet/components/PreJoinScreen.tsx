import { useTranslation } from 'react-i18next';
import { PreJoin, type LocalUserChoices } from '@livekit/components-react';
import '@livekit/components-styles';
import { Button } from '@cuks/ui';
import { useMe } from '@/features/auth/api/queries';

interface Props {
  onJoin: (choices: LocalUserChoices) => void;
  onCancel: () => void;
}

/**
 * Pre-join (docs/modules/14 §3): camera preview, device selection and a mic-level test before
 * entering. Built on the LiveKit `PreJoin` prefab (device enumeration + preview) inside our own
 * chrome. The display name shown to others is set server-side from the session — the prefab's
 * username field is only a local default.
 */
export function PreJoinScreen({ onJoin, onCancel }: Props): React.JSX.Element {
  const { t } = useTranslation('meet');
  const me = useMe();

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-6 bg-surface-0 p-6"
      data-lk-theme="default"
    >
      <div className="text-center">
        <h1 className="text-lg font-semibold text-text">{t('prejoin.heading')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{t('prejoin.subheading')}</p>
      </div>

      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface-1">
        <PreJoin
          defaults={{ username: me.data?.shortName ?? '' }}
          onSubmit={onJoin}
          joinLabel={t('prejoin.join')}
          micLabel={t('room.mic')}
          camLabel={t('room.camera')}
        />
      </div>

      <Button variant="ghost" onClick={onCancel}>
        {t('error.backToMeet')}
      </Button>
    </div>
  );
}
