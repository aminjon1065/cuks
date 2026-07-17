import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import {
  Button,
  PageHeader,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@cuks/ui';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  type NotificationChannel,
  type NotificationGroup,
  type NotificationPrefDto,
} from '@cuks/shared';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '../api/queries';

export function NotificationPrefsPage(): React.JSX.Element {
  const { t } = useTranslation('notifications');
  const { t: tc } = useTranslation('common');
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();

  useEffect(() => {
    document.title = t('prefs.title');
  }, [t]);

  const cell = (
    group: NotificationGroup,
    channel: NotificationChannel,
  ): NotificationPrefDto | undefined =>
    prefs.data?.prefs.find((p) => p.typeGroup === group && p.channel === channel);

  const onToggle = (group: NotificationGroup, channel: NotificationChannel, enabled: boolean) => {
    update.mutate(
      { updates: [{ typeGroup: group, channel, enabled }] },
      {
        onSuccess: () => toast({ title: t('prefs.saved'), tone: 'success' }),
        onError: () => toast({ title: t('prefs.error'), tone: 'danger' }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('prefs.title')} description={t('prefs.subtitle')} />

      {prefs.isLoading ? (
        <Skeleton className="h-64 w-full rounded-md" />
      ) : prefs.isError ? (
        <div className="rounded-md border border-border py-12 text-center text-[13px] text-text-muted">
          {t('prefs.loadError')}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void prefs.refetch()}>
              {tc('actions.retry')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('prefs.groupColumn')}</TableHead>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <TableHead key={c} className="w-28 text-center">
                    {t(`channels.${c}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {NOTIFICATION_GROUPS.map((group) => (
                <TableRow key={group}>
                  <TableCell className="font-medium text-text">{t(`groups.${group}`)}</TableCell>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const c = cell(group, channel);
                    const enabled = c?.enabled ?? true;
                    const locked = c?.locked ?? false;
                    return (
                      <TableCell key={channel} className="text-center">
                        <div className="flex items-center justify-center">
                          {locked ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                                  <Lock className="size-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{t('prefs.lockedHint')}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => onToggle(group, channel, v)}
                              aria-label={`${t(`groups.${group}`)} — ${t(`channels.${channel}`)}`}
                            />
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
