import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Film, Link2, RefreshCw, Video } from 'lucide-react';
import type { MeetingDto, MeetingsRange } from '@cuks/shared';
import { Button, EmptyState, Input, PageHeader, Skeleton, cn, toast } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useCreateRoom, useMeetings } from '../api/queries';
import { MeetingCard } from '../components/MeetingCard';
import { ScheduleMeetingDialog } from '../components/ScheduleMeetingDialog';

const RANGES: MeetingsRange[] = ['today', 'upcoming', 'past'];

/** Extract a room slug from a pasted link (`…/app/meet/r/<slug>`) or a bare code. */
function parseSlug(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const inLink = /\/meet\/r\/([^/?#\s]+)/.exec(value);
  if (inLink?.[1]) return inLink[1];
  return /^[^/\s]+$/.test(value) ? value : null;
}

/** Meet landing (docs/modules/14 §2): the «Встречи» list (today/upcoming/past) plus starting an
 *  instant call, joining by link, and scheduling a meeting. */
export function MeetPage(): React.JSX.Element {
  const { t } = useTranslation('meet');
  useDocumentTitle(t('title'));
  const navigate = useNavigate();
  const createRoom = useCreateRoom();
  const [range, setRange] = useState<MeetingsRange>('today');
  const [link, setLink] = useState('');
  const [scheduling, setScheduling] = useState<MeetingDto | 'new' | null>(null);
  const meetings = useMeetings(range);

  const startInstant = (): void =>
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
      <PageHeader
        title={t('title')}
        description={t('landing.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="gap-1.5"
              onClick={() => navigate('/app/meet/recordings')}
            >
              <Film className="size-4" />
              {t('recordings.title')}
            </Button>
            <Button variant="secondary" className="gap-1.5" onClick={() => setScheduling('new')}>
              <CalendarPlus className="size-4" />
              {t('landing.schedule')}
            </Button>
            <Button className="gap-1.5" onClick={startInstant} disabled={createRoom.isPending}>
              <Video className="size-4" />
              {t('landing.newMeeting')}
            </Button>
          </div>
        }
      />

      <form
        className="mt-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          joinByLink();
        }}
      >
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t('landing.joinPlaceholder')}
            aria-label={t('landing.joinByLink')}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline" disabled={!link.trim()}>
          {t('landing.join')}
        </Button>
      </form>

      <div className="mt-6" role="tablist" aria-label={t('title')}>
        <div className="flex gap-1 border-b border-border">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium',
                range === r
                  ? 'border-primary text-text'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {meetings.isPending ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </div>
            ))}
          </>
        ) : meetings.isError ? (
          <EmptyState
            icon={Video}
            title={t('error.meetingsLoadFailed')}
            action={
              <Button
                variant="secondary"
                className="gap-1.5"
                onClick={() => void meetings.refetch()}
              >
                <RefreshCw className="size-4" />
                {t('retry')}
              </Button>
            }
          />
        ) : (meetings.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title={t('list.empty')}
            description={t('list.emptyHint')}
            action={
              <Button variant="secondary" onClick={() => setScheduling('new')}>
                {t('landing.schedule')}
              </Button>
            }
          />
        ) : (
          meetings.data?.map((m) => (
            <MeetingCard key={m.id} meeting={m} onEdit={(meeting) => setScheduling(meeting)} />
          ))
        )}
      </div>

      {scheduling ? (
        <ScheduleMeetingDialog
          key={scheduling === 'new' ? 'new' : scheduling.id}
          meeting={scheduling === 'new' ? undefined : scheduling}
          onClose={() => setScheduling(null)}
        />
      ) : null}
    </div>
  );
}
