import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Link2, Video } from 'lucide-react';
import { Button, Input, PageHeader, toast } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useCreateRoom } from '../api/queries';

/** Extract a room slug from a pasted link (`…/app/meet/r/<slug>`) or a bare code. */
function parseSlug(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const inLink = /\/meet\/r\/([^/?#\s]+)/.exec(value);
  if (inLink?.[1]) return inLink[1];
  // A bare slug is hex (see the backend's newSlug); reject anything with a slash/space.
  return /^[^/\s]+$/.test(value) ? value : null;
}

/** Meet landing (docs/modules/14 §2): start a new meeting or join by link. The full meetings list
 *  (scheduled/upcoming/past) lands in task 6.5. */
export function MeetPage(): React.JSX.Element {
  const { t } = useTranslation('meet');
  const navigate = useNavigate();
  const createRoom = useCreateRoom();
  const [link, setLink] = useState('');

  const startMeeting = (): void => {
    createRoom.mutate(
      { kind: 'adhoc' },
      {
        onSuccess: (room) => navigate(`/app/meet/r/${room.slug}`),
        onError: (err) =>
          toast({
            title: err instanceof ApiError ? err.message : t('toast.actionFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  const joinByLink = (): void => {
    const slug = parseSlug(link);
    if (!slug) {
      toast({ title: t('landing.invalidLink'), tone: 'danger' });
      return;
    }
    navigate(`/app/meet/r/${slug}`);
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={t('title')} description={t('landing.subtitle')} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface-1 p-5">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Video className="size-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-text">{t('landing.newMeeting')}</h2>
            <p className="text-[13px] text-text-muted">{t('landing.newMeetingHint')}</p>
          </div>
          <Button onClick={startMeeting} disabled={createRoom.isPending}>
            {t('landing.newMeeting')}
          </Button>
        </div>

        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface-1 p-5">
          <div className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-text-muted">
            <Link2 className="size-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-text">{t('landing.joinByLink')}</h2>
          </div>
          <form
            className="flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              joinByLink();
            }}
          >
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t('landing.joinPlaceholder')}
              aria-label={t('landing.joinByLink')}
            />
            <Button type="submit" variant="secondary" disabled={!link.trim()}>
              {t('landing.join')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
