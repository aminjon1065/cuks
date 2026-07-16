import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PhoneCall } from 'lucide-react';
import type { ChannelDto } from '@cuks/shared';
import { Button } from '@cuks/ui';

/** «Идёт звонок» banner shown in a conversation while a call is live on it (docs/modules/14 §2). */
export function CallBanner({ channel }: { channel: ChannelDto }): React.JSX.Element | null {
  const { t } = useTranslation('meet');
  const navigate = useNavigate();
  const call = channel.activeCall;
  if (!call) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/10 px-4 py-2">
      <span className="flex items-center gap-2 text-[13px] font-medium text-text">
        <PhoneCall className="size-4 animate-pulse text-primary" />
        {t('banner.inProgress')}
      </span>
      <Button size="sm" onClick={() => navigate(`/app/meet/r/${call.slug}`)}>
        {t('banner.join')}
      </Button>
    </div>
  );
}
