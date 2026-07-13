import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Download, ScrollText } from 'lucide-react';
import {
  Button,
  EmptyState,
  FilterBar,
  Input,
  PageHeader,
  SidePanel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@cuks/ui';
import type { AuditLogDto, AuditLogQuery } from '@cuks/shared';
import { api } from '@/lib/api-client';
import { useAuditLog } from '../api/queries';
import { downloadCsv, formatDateTime, toCsv } from '../lib';

const PAGE = 25;

export function AuditPage(): React.JSX.Element {
  const { t } = useTranslation('admin');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const query: AuditLogQuery = {
    page,
    limit: PAGE,
    ...(action ? { action } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
  };
  const list = useAuditLog(query);
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));

  const onExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '100' });
      if (action) params.set('action', action);
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      const data = await api.get<{ items: AuditLogDto[] }>(`/v1/admin/audit?${params}`);
      const csv = toCsv(
        data.items.map((r) => ({
          time: formatDateTime(r.createdAt),
          actor: r.actorId ?? t('audit.system'),
          action: r.action,
          entityType: r.entityType ?? '',
          entityId: r.entityId ?? '',
          ip: r.ip ?? '',
        })),
      );
      downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch {
      toast({ title: t('common.actionFailed'), tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = (): void => {
    setAction('');
    setFrom('');
    setTo('');
    setPage(1);
  };
  const hasFilters = !!(action || from || to);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting || total === 0}
          >
            <Download /> {t('audit.export')}
          </Button>
        }
      />

      <FilterBar
        resetLabel={t('common.reset')}
        {...(hasFilters
          ? {
              onReset: resetFilters,
              chips: [{ key: 'f', label: `${list.data?.total ?? 0}`, onRemove: resetFilters }],
            }
          : {})}
      >
        <Input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          placeholder={t('audit.filters.actionPlaceholder')}
          className="h-8 w-52"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className="h-8 w-40"
          aria-label={t('audit.filters.from')}
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className="h-8 w-40"
          aria-label={t('audit.filters.to')}
        />
      </FilterBar>

      {list.isLoading ? (
        <Skeleton className="h-72 w-full rounded-md" />
      ) : list.isError ? (
        <div className="rounded-md border border-border py-10 text-center text-[13px] text-text-muted">
          {t('common.loadError')}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t('audit.empty.title')}
          description={t('audit.empty.description')}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-36">{t('audit.columns.time')}</TableHead>
                <TableHead>{t('audit.columns.action')}</TableHead>
                <TableHead>{t('audit.columns.entity')}</TableHead>
                <TableHead className="w-28">{t('audit.columns.ip')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((r) => (
                <TableRow key={r.id} onClick={() => setSelected(r)} className="cursor-pointer">
                  <TableCell className="whitespace-nowrap text-text-muted">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text">{r.action}</TableCell>
                  <TableCell className="text-text-muted">
                    {r.entityType
                      ? `${r.entityType}${r.entityId ? `:${r.entityId.slice(0, 8)}` : ''}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-text-muted">{r.ip ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <span>
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="prev"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            aria-label="next"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}

      <SidePanel
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={t('audit.detail.title')}
        closeLabel={t('common.close')}
      >
        {selected ? (
          <dl className="space-y-3 text-[13px]">
            <Field label={t('audit.detail.action')} value={selected.action} mono />
            <Field label={t('audit.detail.actor')} value={selected.actorId ?? t('audit.system')} />
            <Field
              label={t('audit.detail.entity')}
              value={
                selected.entityType ? `${selected.entityType}:${selected.entityId ?? ''}` : '—'
              }
            />
            <Field label={t('audit.detail.ip')} value={selected.ip ?? '—'} />
            <Field label={t('audit.detail.userAgent')} value={selected.userAgent ?? '—'} />
            <Field label={t('audit.detail.time')} value={formatDateTime(selected.createdAt)} />
            <div>
              <dt className="text-xs text-text-muted">{t('audit.detail.meta')}</dt>
              <dd>
                <pre className="mt-1 overflow-x-auto rounded-sm border border-border bg-surface-2 p-2 font-mono text-xs text-text">
                  {JSON.stringify(selected.meta ?? {}, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        ) : null}
      </SidePanel>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-[13px] text-text' : 'text-[13px] text-text'}>
        {value}
      </dd>
    </div>
  );
}
