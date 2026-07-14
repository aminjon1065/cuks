import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { ExportDialog } from '@/features/map/components/ExportDialog';
import { Download, Globe, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterBar,
  type FilterChip,
  Input,
  Label,
  PageHeader,
  SeverityBadge,
  SidePanel,
  Skeleton,
  StatusBadge,
  toast,
} from '@cuks/ui';
import {
  INCIDENT_STATUSES,
  type IncidentListItemDto,
  type IncidentRegistryFilters,
  type ListIncidentsQuery,
} from '@cuks/shared';
import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import { useCan } from '@/lib/ability';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import {
  exportIncidents,
  incidentsKey,
  useIncident,
  useIncidentOptions,
  useIncidents,
  useRemoveIncidentFilter,
  useSaveIncidentFilter,
  useSavedIncidentFilters,
} from '../api/queries';
import {
  dushanbeDateFromIso,
  dushanbeDayIso,
  formatDamage,
  formatNumber,
  incidentStatusTone,
} from '../lib';
import { CreateIncidentDialog } from '../components/CreateIncidentDialog';

const PAGE_SIZE = 25;

interface FilterState {
  fromDate: string;
  toDate: string;
  typeCode: string;
  severity: string;
  status: string;
  regionId: string;
  search: string;
}

const emptyFilters = (): FilterState => ({
  fromDate: '',
  toDate: '',
  typeCode: '',
  severity: '',
  status: '',
  regionId: '',
  search: '',
});

function toApiFilters(filters: FilterState): IncidentRegistryFilters {
  return {
    ...(filters.fromDate ? { from: dushanbeDayIso(filters.fromDate) } : {}),
    ...(filters.toDate ? { to: dushanbeDayIso(filters.toDate, true) } : {}),
    ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
    ...(filters.severity ? { severity: Number(filters.severity) as 1 | 2 | 3 | 4 | 5 } : {}),
    ...(filters.status ? { status: filters.status as IncidentRegistryFilters['status'] } : {}),
    ...(filters.regionId ? { regionId: filters.regionId } : {}),
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
  };
}

function fromSavedFilters(filters: IncidentRegistryFilters): FilterState {
  return {
    fromDate: filters.from ? dushanbeDateFromIso(filters.from) : '',
    toDate: filters.to ? dushanbeDateFromIso(filters.to) : '',
    typeCode: filters.typeCode ?? '',
    severity: filters.severity ? String(filters.severity) : '',
    status: filters.status ?? '',
    regionId: filters.regionId ?? '',
    search: filters.search ?? '',
  };
}

export function IncidentsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation('incidents');
  const navigate = useNavigate();
  const canView = useCan('gis.view');
  const canCreate = useCan('incidents.create');
  const canExport = useCan('gis.export');
  const [geoExportOpen, setGeoExportOpen] = useState(false);
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [filterName, setFilterName] = useState('');
  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);
  const query: ListIncidentsQuery = { page, limit: PAGE_SIZE, sort: '-occurredAt', ...apiFilters };
  const list = useIncidents(query);
  const options = useIncidentOptions();
  const saved = useSavedIncidentFilters();
  const save = useSaveIncidentFilter();
  const remove = useRemoveIncidentFilter();
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [deleteSavedOpen, setDeleteSavedOpen] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const preview = useIncident(selectedIncidentId ?? undefined);

  useSocketEvent(
    'incidents.updated',
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: [...incidentsKey, 'list'] });
    }, [queryClient]),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        !canCreate ||
        event.key.toLowerCase() !== 'c' ||
        (target instanceof HTMLElement && target.closest('input, textarea, select, button'))
      )
        return;
      event.preventDefault();
      setCreateOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canCreate]);

  const columns = useMemo<ColumnDef<IncidentListItemDto, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('table.number'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
      },
      {
        accessorKey: 'occurredAt',
        header: t('table.date'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {formatDateTime(row.original.occurredAt)}
          </span>
        ),
      },
      { accessorKey: 'typeName', header: t('table.type') },
      {
        accessorKey: 'severity',
        header: t('table.severity'),
        cell: ({ row }) => (
          <SeverityBadge
            level={row.original.severity}
            label={t(`severity.${row.original.severity}`)}
          />
        ),
      },
      {
        id: 'territory',
        header: t('table.territory'),
        cell: ({ row }) => (
          <span className="text-xs text-text-muted">
            {[row.original.regionName, row.original.districtName].filter(Boolean).join(' · ') ||
              '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('table.status'),
        cell: ({ row }) => (
          <StatusBadge
            tone={incidentStatusTone[row.original.status]}
            label={t(`status.${row.original.status}`)}
          />
        ),
      },
      {
        id: 'casualties',
        header: t('table.casualties'),
        cell: ({ row }) => (
          <span className="text-xs">
            {formatNumber(row.original.dead)} / {formatNumber(row.original.injured)}
          </span>
        ),
      },
      {
        id: 'damage',
        header: t('table.damage'),
        cell: ({ row }) => (
          <span className="text-xs">{formatDamage(row.original.damageEst) ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'ownerName',
        header: t('table.owner'),
        cell: ({ row }) => (
          <span className="text-xs text-text-muted">{row.original.ownerName ?? '—'}</span>
        ),
      },
    ],
    [t],
  );

  if (!canView) return <ForbiddenPage />;
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Object.values(filters).some(Boolean);
  const chips: FilterChip[] = [];
  if (filters.search)
    chips.push({
      key: 'search',
      label: filters.search,
      onRemove: () => setFilters((value) => ({ ...value, search: '' })),
    });
  if (filters.fromDate)
    chips.push({
      key: 'from',
      label: filters.fromDate,
      onRemove: () => setFilters((value) => ({ ...value, fromDate: '' })),
    });
  if (filters.toDate)
    chips.push({
      key: 'to',
      label: filters.toDate,
      onRemove: () => setFilters((value) => ({ ...value, toDate: '' })),
    });

  const applySaved = (id: string): void => {
    setSelectedSavedId(id);
    const preset = saved.data?.find((item) => item.id === id);
    if (!preset) return;
    setFilters(fromSavedFilters(preset.params));
    setPage(1);
  };
  const selectedSaved = saved.data?.find((item) => item.id === selectedSavedId);
  const saveCurrent = (): void => {
    save.mutate(
      { name: filterName.trim(), params: apiFilters },
      {
        onSuccess: () => {
          toast({ title: t('filters.saved'), tone: 'success' });
          setSaveOpen(false);
          setFilterName('');
        },
        onError: (error) =>
          toast({
            title: error instanceof ApiError ? error.message : t('filters.saveFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            {canExport ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void exportIncidents(apiFilters).catch(() =>
                      toast({ title: t('filters.exportFailed'), tone: 'danger' }),
                    )
                  }
                >
                  <Download /> {t('actions.export')}
                </Button>
                {/* The geo formats are big enough to belong in the worker (2.8): the
                    request is queued and the file arrives with a notification. */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setGeoExportOpen(true)}
                  data-testid="incidents-export-geo"
                >
                  <Globe /> {t('actions.exportGeo')}
                </Button>
              </>
            ) : null}
            {canCreate ? (
              <Button size="sm" data-testid="incidents-create" onClick={() => setCreateOpen(true)}>
                <Plus /> {t('actions.create')}
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        chips={chips}
        {...(hasFilters
          ? {
              onReset: () => {
                setFilters(emptyFilters());
                setPage(1);
                setSelectedSavedId('');
              },
            }
          : {})}
        resetLabel={t('filters.reset')}
        removeLabel={(chip) => t('filters.remove', { name: chip.label })}
      >
        <Input
          value={filters.search}
          onChange={(event) => {
            setFilters((value) => ({ ...value, search: event.target.value }));
            setPage(1);
          }}
          placeholder={t('filters.search')}
          className="h-8 w-48"
          data-testid="incidents-search"
        />
        <Input
          type="date"
          aria-label={t('filters.from')}
          value={filters.fromDate}
          max={filters.toDate || undefined}
          onChange={(event) => {
            setFilters((value) => ({ ...value, fromDate: event.target.value }));
            setPage(1);
          }}
          className="h-8 w-36"
        />
        <Input
          type="date"
          aria-label={t('filters.to')}
          value={filters.toDate}
          min={filters.fromDate || undefined}
          onChange={(event) => {
            setFilters((value) => ({ ...value, toDate: event.target.value }));
            setPage(1);
          }}
          className="h-8 w-36"
        />
        <select
          value={filters.typeCode}
          aria-label={t('filters.type')}
          onChange={(event) => {
            setFilters((value) => ({ ...value, typeCode: event.target.value }));
            setPage(1);
          }}
          className="h-8 max-w-52 rounded-sm border border-border bg-surface px-2 text-[13px] text-text"
        >
          <option value="">{t('filters.allTypes')}</option>
          {options.data?.types.map((item) => (
            <option key={item.code} value={item.code}>
              {i18n.resolvedLanguage === 'tg' ? item.nameTg : item.nameRu}
            </option>
          ))}
        </select>
        <select
          value={filters.severity}
          aria-label={t('filters.severity')}
          onChange={(event) => {
            setFilters((value) => ({ ...value, severity: event.target.value }));
            setPage(1);
          }}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-text"
        >
          <option value="">{t('filters.allSeverity')}</option>
          {[1, 2, 3, 4, 5].map((level) => (
            <option key={level} value={level}>
              {t(`severity.${level}`)}
            </option>
          ))}
        </select>
        <select
          value={filters.status}
          aria-label={t('filters.status')}
          onChange={(event) => {
            setFilters((value) => ({ ...value, status: event.target.value }));
            setPage(1);
          }}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-text"
        >
          <option value="">{t('filters.allStatuses')}</option>
          {INCIDENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
        <select
          value={filters.regionId}
          aria-label={t('filters.region')}
          onChange={(event) => {
            setFilters((value) => ({ ...value, regionId: event.target.value }));
            setPage(1);
          }}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-text"
        >
          <option value="">{t('filters.allRegions')}</option>
          {options.data?.regions.map((region) => (
            <option key={region.id} value={region.id}>
              {i18n.resolvedLanguage === 'tg' ? region.nameTg : region.nameRu}
            </option>
          ))}
        </select>
        <select
          value={selectedSavedId}
          aria-label={t('filters.savedFilters')}
          onChange={(event) => applySaved(event.target.value)}
          className="h-8 max-w-44 rounded-sm border border-border bg-surface px-2 text-[13px] text-text"
        >
          <option value="">{t('filters.savedFilters')}</option>
          {saved.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('filters.save')}
          onClick={() => setSaveOpen(true)}
        >
          <Save />
        </Button>
        {selectedSavedId ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('filters.deleteSaved')}
            onClick={() => setDeleteSavedOpen(true)}
          >
            <Trash2 />
          </Button>
        ) : null}
      </FilterBar>

      <div className="rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          error={list.isError ? t('loadError') : undefined}
          onRetry={() => void list.refetch()}
          empty={
            <EmptyState
              icon={ShieldAlert}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                canCreate ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    {t('actions.create')}
                  </Button>
                ) : undefined
              }
            />
          }
          onRowClick={(item) => setSelectedIncidentId(item.id)}
          onRowDoubleClick={(item) => navigate(`/app/incidents/${item.id}`)}
          onRowEnter={(item) => navigate(`/app/incidents/${item.id}`)}
          pageSize={PAGE_SIZE}
        />
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <span>
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('actions.previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page === pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('actions.next')}
          </Button>
        </div>
      ) : null}

      {geoExportOpen ? (
        <ExportDialog
          open
          onOpenChange={setGeoExportOpen}
          request={{
            source: 'incidents',
            filters: apiFilters,
            subject: t('actions.exportGeoSubject'),
          }}
        />
      ) : null}

      <CreateIncidentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        options={options.data}
        onCreated={(id) => navigate(`/app/incidents/${id}`)}
      />
      <SidePanel
        open={selectedIncidentId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedIncidentId(null);
        }}
        closeLabel={t('actions.close')}
        title={preview.data?.number ?? t('card.previewTitle')}
        footer={
          preview.data ? (
            <Button
              className="w-full"
              onClick={() => {
                setSelectedIncidentId(null);
                navigate(`/app/incidents/${preview.data.id}`);
              }}
            >
              {t('card.openFull')}
            </Button>
          ) : undefined
        }
      >
        {preview.isLoading ? <Skeleton className="h-52 w-full" /> : null}
        {preview.isError || !preview.data ? (
          !preview.isLoading ? (
            <EmptyState icon={ShieldAlert} title={t('card.loadError')} />
          ) : null
        ) : (
          <div className="space-y-4 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <SeverityBadge
                level={preview.data.severity}
                label={t(`severity.${preview.data.severity}`)}
              />
              <StatusBadge
                tone={incidentStatusTone[preview.data.status]}
                label={t(`status.${preview.data.status}`)}
              />
            </div>
            <div>
              <div className="text-xs text-text-muted">{t('table.type')}</div>
              <div className="mt-1 text-text">{preview.data.typeName}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">{t('card.territory')}</div>
              <div className="mt-1 text-text">
                {[preview.data.regionName, preview.data.districtName].filter(Boolean).join(' · ') ||
                  '—'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-surface-2 p-3">
                <div className="text-xs text-text-muted">{t('figures.dead')}</div>
                <div className="mt-1 text-lg font-semibold">{formatNumber(preview.data.dead)}</div>
              </div>
              <div className="rounded-md bg-surface-2 p-3">
                <div className="text-xs text-text-muted">{t('figures.injured')}</div>
                <div className="mt-1 text-lg font-semibold">
                  {formatNumber(preview.data.injured)}
                </div>
              </div>
            </div>
            {preview.data.description ? (
              <p className="whitespace-pre-wrap text-text">{preview.data.description}</p>
            ) : null}
          </div>
        )}
      </SidePanel>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent closeLabel={t('actions.close')}>
          <DialogHeader>
            <DialogTitle>{t('filters.saveTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="incident-filter-name" required>
              {t('filters.name')}
            </Label>
            <Input
              id="incident-filter-name"
              value={filterName}
              onChange={(event) => setFilterName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button disabled={!filterName.trim() || save.isPending} onClick={saveCurrent}>
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteSavedOpen}
        onOpenChange={setDeleteSavedOpen}
        title={t('filters.deleteTitle')}
        description={t('filters.deleteDescription')}
        entityName={selectedSaved?.name}
        confirmLabel={t('filters.deleteConfirm')}
        cancelLabel={t('actions.cancel')}
        closeLabel={t('actions.close')}
        loading={remove.isPending}
        onConfirm={() => {
          if (!selectedSaved) return;
          remove.mutate(selectedSaved.id, {
            onSuccess: () => {
              setSelectedSavedId('');
              setDeleteSavedOpen(false);
            },
            onError: (error) =>
              toast({
                title: error instanceof ApiError ? error.message : t('filters.deleteFailed'),
                tone: 'danger',
              }),
          });
        }}
      />
    </div>
  );
}
