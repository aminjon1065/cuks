import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Printer } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, EmptyState, PageHeader, cn } from '@cuks/ui';
import type { DocumentListItemDto, ListDocumentsQuery } from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { formatDateTime } from '@/lib/format';
import { useDocuments, useJournals } from '../api/queries';
import { RegisterWizard } from '../components/RegisterWizard';

const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

/** Journals register (docs/modules/11 §7, `docflow.register`): pick a journal + year, view
 *  the registered documents, print the register, and launch the incoming-doc wizard. */
export function JournalsRegisterPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const navigate = useNavigate();
  const canRegister = useCan('docflow.register');
  const journals = useJournals();
  const activeJournals = useMemo(
    () => (journals.data ?? []).filter((j) => j.isActive),
    [journals.data],
  );
  const [journalId, setJournalId] = useState('');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [wizardOpen, setWizardOpen] = useState(false);

  const journal = journalId || activeJournals[0]?.id || '';
  // The register lists every document registered in this journal that year — regardless of
  // its current lifecycle status (a resolution advances it to in_progress etc., but it stays
  // in the register). journalId + year (reg_date) already scope it to registered documents.
  const query: ListDocumentsQuery = {
    page: 1,
    limit: 200,
    queue: 'registry',
    year,
    ...(journal ? { journalId: journal } : {}),
  };
  const list = useDocuments(query, { enabled: !!journal });

  const columns = useMemo<ColumnDef<DocumentListItemDto, unknown>[]>(
    () => [
      {
        accessorKey: 'regNumber',
        header: t('documents.columns.number'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.regNumber ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'regDate',
        header: t('documents.card.regDate'),
        cell: ({ row }) => (row.original.regDate ? formatDateTime(row.original.regDate) : '—'),
      },
      {
        accessorKey: 'subject',
        header: t('documents.columns.subject'),
        cell: ({ row }) => <span className="font-medium text-text">{row.original.subject}</span>,
      },
      {
        accessorKey: 'correspondentName',
        header: t('documents.card.correspondent'),
        cell: ({ row }) => row.original.correspondentName ?? '—',
      },
      {
        accessorKey: 'docClass',
        header: t('documents.columns.class'),
        cell: ({ row }) => t(`docClass.${row.original.docClass}`),
      },
    ],
    [t],
  );

  const journalName = activeJournals.find((j) => j.id === journal)?.name ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <PageHeader
          title={t('register.journals.title')}
          description={t('register.journals.subtitle')}
          actions={
            canRegister ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="size-4" /> {t('register.journals.print')}
                </Button>
                <Button size="sm" onClick={() => setWizardOpen(true)}>
                  <Plus className="size-4" /> {t('register.journals.newIncoming')}
                </Button>
              </div>
            ) : undefined
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select
          aria-label={t('register.journals.journal')}
          className={selectClass}
          value={journal}
          onChange={(e) => setJournalId(e.target.value)}
        >
          {activeJournals.length === 0 ? (
            <option value="">{t('register.journals.noJournals')}</option>
          ) : (
            activeJournals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))
          )}
        </select>
        <select
          aria-label={t('register.journals.year')}
          className={selectClass}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Printed register header (visible only on print). */}
      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">
          {t('register.journals.registerHeading', { journal: journalName, year })}
        </h1>
      </div>

      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        error={list.isError ? t('common.loadError') : undefined}
        onRetry={() => void list.refetch()}
        pageSize={200}
        onRowClick={(row) => navigate(`/app/docs/${row.id}`)}
        empty={
          <EmptyState
            icon={FileText}
            title={t('register.journals.empty.title')}
            description={t('register.journals.empty.description')}
          />
        }
      />

      {wizardOpen ? <RegisterWizard onClose={() => setWizardOpen(false)} /> : null}
    </div>
  );
}
