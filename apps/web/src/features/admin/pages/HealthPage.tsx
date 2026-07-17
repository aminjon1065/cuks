import { useTranslation } from 'react-i18next';
import { Activity, Database, HardDrive, Package, RefreshCw } from 'lucide-react';
import {
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@cuks/ui';
import type {
  DependencyState,
  HealthOverview,
  HealthState,
  QueueStats,
  ServiceStatus,
} from '@cuks/shared';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useHealth, useRetryQueue } from '../api/queries';

const OVERALL_TONE: Record<HealthState, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
};

function serviceTone(s: ServiceStatus): 'success' | 'danger' | 'neutral' {
  if (s.note === 'not-configured') return 'neutral';
  return s.state === 'up' ? 'success' : 'danger';
}

export function HealthPage(): React.JSX.Element {
  const { t } = useTranslation('admin');
  const health = useHealth();
  const retry = useRetryQueue();
  const data = health.data;

  const onRetry = (name: string): void => {
    retry.mutate(name, {
      onSuccess: (res) => {
        toast({ title: t('health.queues.retried', { n: res.retried, name }), tone: 'success' });
      },
      onError: () => {
        toast({ title: t('common.actionFailed'), tone: 'danger' });
      },
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('health.title')}
        description={t('health.subtitle')}
        {...(data
          ? {
              status: (
                <StatusBadge
                  tone={OVERALL_TONE[data.status]}
                  label={t(`health.status.${data.status}`)}
                />
              ),
            }
          : {})}
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
            aria-label={t('health.refresh')}
          >
            <RefreshCw className={health.isFetching ? 'animate-spin' : ''} />
          </Button>
        }
      />

      {health.isLoading ? (
        <HealthSkeleton />
      ) : health.isError || !data ? (
        <EmptyState icon={Activity} title={t('health.error')} />
      ) : (
        <div className="space-y-6">
          <Services services={data.services} t={t} />
          <Storage storage={data.storage} t={t} />
          <Queues queues={data.queues} onRetry={onRetry} retrying={retry.isPending} t={t} />
          <BackupAndErrors data={data} t={t} />
        </div>
      )}
    </div>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Services({ services, t }: { services: ServiceStatus[]; t: TFn }): React.JSX.Element {
  const stateLabel = (s: ServiceStatus): string =>
    s.note === 'not-configured'
      ? t('health.serviceState.notConfigured')
      : t(`health.serviceState.${s.state satisfies DependencyState}`);
  return (
    <Section title={t('health.services.title')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {services.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
          >
            <span className="text-sm">{t(`health.service.${s.key}`)}</span>
            <StatusBadge tone={serviceTone(s)} label={stateLabel(s)} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Storage({
  storage,
  t,
}: {
  storage: HealthOverview['storage'];
  t: TFn;
}): React.JSX.Element {
  const diskCaption =
    storage.diskFreeBytes != null && storage.diskTotalBytes != null
      ? t('health.storage.diskCaption', {
          free: formatBytes(storage.diskFreeBytes),
          total: formatBytes(storage.diskTotalBytes),
        })
      : t('health.storage.diskUnavailable');
  return (
    <Section title={t('health.storage.title')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={t('health.storage.db')}
          value={formatBytes(storage.dbBytes)}
          icon={Database}
        />
        <StatCard
          label={t('health.storage.bucket')}
          value={formatBytes(storage.bucketBytes)}
          caption={t('health.storage.objects', { n: storage.bucketObjects })}
          icon={Package}
        />
        <StatCard
          label={t('health.storage.disk')}
          value={storage.diskFreeBytes != null ? formatBytes(storage.diskFreeBytes) : '—'}
          caption={diskCaption}
          icon={HardDrive}
        />
      </div>
      {storage.dbSchemas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {storage.dbSchemas.map((s) => (
            <span
              key={s.schema}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-muted"
            >
              {s.schema} · {formatBytes(s.bytes)}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}

function Queues({
  queues,
  onRetry,
  retrying,
  t,
}: {
  queues: QueueStats[];
  onRetry: (name: string) => void;
  retrying: boolean;
  t: TFn;
}): React.JSX.Element {
  return (
    <Section title={t('health.queues.title')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('health.queues.name')}</TableHead>
            <TableHead className="text-right">{t('health.queues.waiting')}</TableHead>
            <TableHead className="text-right">{t('health.queues.active')}</TableHead>
            <TableHead className="text-right">{t('health.queues.delayed')}</TableHead>
            <TableHead className="text-right">{t('health.queues.failed')}</TableHead>
            <TableHead className="text-right">{t('health.queues.completed')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {queues.map((q) => (
            <TableRow key={q.name}>
              <TableCell className="font-medium">{q.name}</TableCell>
              <TableCell className="text-right tabular-nums">{q.waiting}</TableCell>
              <TableCell className="text-right tabular-nums">{q.active}</TableCell>
              <TableCell className="text-right tabular-nums">{q.delayed}</TableCell>
              <TableCell
                className={`text-right tabular-nums ${q.failed > 0 ? 'font-semibold text-danger' : ''}`}
              >
                {q.failed}
              </TableCell>
              <TableCell className="text-right tabular-nums text-text-muted">
                {q.completed}
              </TableCell>
              <TableCell className="text-right">
                {q.failed > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={retrying}
                    onClick={() => onRetry(q.name)}
                  >
                    {t('health.queues.retry')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function BackupAndErrors({ data, t }: { data: HealthOverview; t: TFn }): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard
        label={t('health.backup.title')}
        value={
          data.backup.lastSuccessAt
            ? formatDateTime(data.backup.lastSuccessAt)
            : t('health.backup.never')
        }
        {...(data.backup.snapshotId
          ? { caption: t('health.backup.snapshot', { id: data.backup.snapshotId }) }
          : {})}
      />
      <StatCard label={t('health.errors.title')} value={String(data.errors24h)} />
    </div>
  );
}

function HealthSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
