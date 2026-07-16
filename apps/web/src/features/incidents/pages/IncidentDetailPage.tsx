import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, FileText, MessageSquare, Plus, UsersRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEventPayloads } from '@cuks/shared';
import {
  Button,
  EmptyState,
  PageHeader,
  SeverityBadge,
  Skeleton,
  StatusBadge,
  toast,
} from '@cuks/ui';
import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import { useCan } from '@/lib/ability';
import { useOpenIncidentChannel } from '@/features/chat/api/queries';
import { formatDateTime } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { incidentsKey, useIncident } from '../api/queries';
import {
  formatDamage,
  formatNumber,
  incidentStatusTone,
  readIncidentStatusEventMeta,
} from '../lib';
import { AddIncidentReportDialog } from '../components/AddIncidentReportDialog';
import { AddIncidentResourceDialog } from '../components/AddIncidentResourceDialog';
import { IncidentLocationPicker } from '../components/IncidentLocationPicker';
import { ChangeIncidentStatusDialog } from '../components/ChangeIncidentStatusDialog';
import { IncidentStatusStepper } from '../components/IncidentStatusStepper';
import { LinkedTasksSection } from '@/features/tasks/components/LinkedTasksSection';

type Tab = 'overview' | 'timeline' | 'resources' | 'tasks';

export function IncidentDetailPage(): React.JSX.Element {
  const { t } = useTranslation('incidents');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const canView = useCan('gis.view');
  const canCreate = useCan('incidents.create');
  const canManage = useCan('incidents.manage');
  const incidentChannel = useOpenIncidentChannel();
  const incident = useIncident(id);
  const [tab, setTab] = useState<Tab>('overview');
  const [reportOpen, setReportOpen] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const openChannel = useCallback((): void => {
    if (!id) return;
    incidentChannel.mutate(id, {
      onSuccess: (channel) => void navigate(`/app/chat/${channel.id}`),
      onError: () => toast({ title: t('card.openChatChannelFailed'), tone: 'danger' }),
    });
  }, [id, incidentChannel, navigate, t]);

  const onIncidentUpdate = useCallback(
    (event: WsEventPayloads['incidents.updated']) => {
      if (event.id === id) {
        void queryClient.invalidateQueries({ queryKey: [...incidentsKey, 'detail', id] });
      }
    },
    [id, queryClient],
  );
  useSocketEvent('incidents.updated', onIncidentUpdate);

  useEffect(() => {
    if (incident.data) document.title = `${incident.data.number} — ${t('title')}`;
  }, [incident.data, t]);

  const timeline = useMemo(() => {
    if (!incident.data) return [];
    return [
      ...incident.data.reports.map((report) => ({
        kind: 'report' as const,
        id: report.id,
        createdAt: report.reportedAt,
        label: report.text || t('card.reportWithoutText'),
        author: report.authorName,
        snapshot: {
          dead: report.dead,
          injured: report.injured,
          evacuated: report.evacuated,
          affected: report.affected,
          damageEst: report.damageEst,
          damageNote: report.damageNote,
        },
      })),
      ...incident.data.events.map((event) => {
        const transition = readIncidentStatusEventMeta(event.meta);
        return {
          kind: 'event' as const,
          id: event.id,
          createdAt: event.createdAt,
          label: transition
            ? t('events.statusChanged', {
                from: t(`status.${transition.fromStatus}`),
                to: t(`status.${transition.toStatus}`),
              })
            : t(`events.${event.action}`, { defaultValue: event.action }),
          author: event.actorName,
          detail: transition?.reason ?? null,
        };
      }),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [incident.data, t]);

  if (!canView) return <ForbiddenPage />;
  if (incident.isLoading)
    return (
      <div className="p-6">
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  if (incident.isError || !incident.data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FileText}
          title={t('card.loadError')}
          action={<Button onClick={() => void incident.refetch()}>{t('actions.retry')}</Button>}
        />
      </div>
    );
  }
  const data = incident.data;
  const facts = [
    ['dead', data.dead],
    ['injured', data.injured],
    ['evacuated', data.evacuated],
    ['affected', data.affected],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/app/incidents')}>
        <ArrowLeft /> {t('actions.back')}
      </Button>
      <PageHeader
        title={data.number}
        status={
          <span data-testid="incident-current-status">
            <StatusBadge
              tone={incidentStatusTone[data.status]}
              label={t(`status.${data.status}`)}
            />
          </span>
        }
        description={`${data.typeName} · ${formatDateTime(data.occurredAt)}`}
        actions={
          <>
            <SeverityBadge level={data.severity} label={t(`severity.${data.severity}`)} />
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={openChannel}
                disabled={incidentChannel.isPending}
              >
                <MessageSquare /> {t('card.openChatChannel')}
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>
                <ArrowRightLeft /> {t('statusChange.action')}
              </Button>
            ) : null}
            {canCreate && data.status !== 'closed' ? (
              <Button size="sm" onClick={() => setReportOpen(true)}>
                <Plus /> {t('card.addReport')}
              </Button>
            ) : null}
          </>
        }
      />
      <IncidentStatusStepper
        status={data.status}
        label={t('statusChange.stepperLabel')}
        statusLabel={(status) => t(`status.${status}`)}
      />
      <div
        className="flex gap-1 border-b border-border"
        role="tablist"
        aria-label={t('card.tabsLabel')}
      >
        {(['overview', 'timeline', 'resources', 'tasks'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
            className={`border-b-2 px-3 py-2 text-[13px] font-medium ${tab === item ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {t(`tabs.${item}`)}
          </button>
        ))}
      </div>
      {tab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <IncidentLocationPicker value={data.location} ariaLabel={t('card.overviewMap')} />
            <div className="grid grid-cols-2 gap-3 text-[13px] md:grid-cols-4">
              {facts.map(([key, value]) => (
                <div key={key} className="rounded-md bg-surface-2 p-3">
                  <div className="text-xs text-text-muted">{t(`figures.${key}`)}</div>
                  <div className="mt-1 text-lg font-semibold text-text">{formatNumber(value)}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-4 rounded-lg border border-border bg-surface p-4 text-[13px]">
            <div>
              <div className="text-xs text-text-muted">{t('card.territory')}</div>
              <div className="mt-1 text-text">
                {[data.regionName, data.districtName].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">{t('card.address')}</div>
              <div className="mt-1 text-text">{data.addressText ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">{t('card.damage')}</div>
              <div className="mt-1 text-text">{formatDamage(data.damageEst) ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">{t('card.description')}</div>
              <p className="mt-1 whitespace-pre-wrap text-text">{data.description ?? '—'}</p>
            </div>
            {data.closedAt ? (
              <div>
                <div className="text-xs text-text-muted">{t('card.closed')}</div>
                <div className="mt-1 text-text">
                  {formatDateTime(data.closedAt)}
                  {data.closedByName ? ` · ${data.closedByName}` : ''}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
      {tab === 'timeline' ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          {timeline.length ? (
            <ol className="space-y-4">
              {timeline.map((entry) => (
                <li key={`${entry.kind}-${entry.id}`} className="border-l-2 border-primary/30 pl-4">
                  <div className="text-xs text-text-muted">
                    {formatDateTime(entry.createdAt)}
                    {entry.author ? ` · ${entry.author}` : ''}
                  </div>
                  <p className="mt-1 text-[13px] text-text">{entry.label}</p>
                  {entry.kind === 'event' && entry.detail ? (
                    <p className="mt-1 rounded-sm bg-surface-2 px-2 py-1.5 text-xs text-text-muted">
                      {t('statusChange.reasonLabel')}: {entry.detail}
                    </p>
                  ) : null}
                  {entry.kind === 'report' ? (
                    <div
                      className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
                      data-testid="incident-report-snapshot"
                    >
                      {(
                        [
                          ['dead', entry.snapshot.dead],
                          ['injured', entry.snapshot.injured],
                          ['evacuated', entry.snapshot.evacuated],
                          ['affected', entry.snapshot.affected],
                        ] as const
                      ).map(([key, value]) => (
                        <div key={key} className="rounded-sm bg-surface-2 px-2 py-1.5">
                          <div className="text-[11px] text-text-muted">{t(`figures.${key}`)}</div>
                          <div className="font-medium text-text">{formatNumber(value ?? 0)}</div>
                        </div>
                      ))}
                      {entry.snapshot.damageEst || entry.snapshot.damageNote ? (
                        <div className="col-span-2 rounded-sm bg-surface-2 px-2 py-1.5 sm:col-span-4">
                          <div className="text-[11px] text-text-muted">{t('card.damage')}</div>
                          <div className="font-medium text-text">
                            {formatDamage(entry.snapshot.damageEst) ?? '—'}
                          </div>
                          {entry.snapshot.damageNote ? (
                            <div className="mt-0.5 text-xs text-text-muted">
                              {entry.snapshot.damageNote}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={FileText} title={t('card.timelineEmpty')} />
          )}
        </section>
      ) : null}
      {tab === 'resources' ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-4 flex justify-end">
            {canManage && data.status !== 'closed' ? (
              <Button size="sm" onClick={() => setResourceOpen(true)}>
                <Plus /> {t('card.addResource')}
              </Button>
            ) : null}
          </div>
          {data.resources.length ? (
            <ul className="divide-y divide-border">
              {data.resources.map((resource) => (
                <li
                  key={resource.id}
                  className="flex items-center justify-between gap-4 py-3 text-[13px]"
                >
                  <div>
                    <div className="font-medium text-text">{resource.name}</div>
                    <div className="text-xs text-text-muted">
                      {t(`resources.${resource.kind}`)}
                      {resource.orgText ? ` · ${resource.orgText}` : ''}
                      {resource.period ? ` · ${resource.period}` : ''}
                    </div>
                  </div>
                  <div className="font-mono text-text">× {formatNumber(resource.qty)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UsersRound}
              title={t('card.resourcesEmpty')}
              description={canManage ? t('card.resourcesEmptyHint') : undefined}
            />
          )}
        </section>
      ) : null}
      {tab === 'tasks' ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <LinkedTasksSection
            targetType="incident"
            targetId={data.id}
            presetTitle={`${data.number} — ${data.typeName}`}
          />
        </section>
      ) : null}
      <AddIncidentReportDialog
        incidentId={data.id}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
      <AddIncidentResourceDialog
        incidentId={data.id}
        open={resourceOpen}
        onOpenChange={setResourceOpen}
      />
      <ChangeIncidentStatusDialog
        incidentId={data.id}
        currentStatus={data.status}
        open={statusOpen}
        onOpenChange={setStatusOpen}
      />
    </div>
  );
}
