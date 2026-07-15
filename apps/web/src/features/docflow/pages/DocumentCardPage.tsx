import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileCheck2, Paperclip } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import {
  DOCUMENT_STATUS_TRANSITIONS,
  type DocumentDetailDto,
  type DocumentStatus,
} from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import {
  useChangeDocumentStatus,
  useDocument,
  useDocumentTypes,
  useJournals,
  useRegisterDocument,
} from '../api/queries';
import { documentStatusTone } from '../lib/document';
import { RouteSection } from '../components/RouteSection';
import { ResolutionSection } from '../components/ResolutionSection';
import { SignatureSection } from '../components/SignatureSection';
import { AcknowledgementSection } from '../components/AcknowledgementSection';

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export function DocumentCardPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const doc = useDocument(id ?? null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  if (doc.isPending) {
    return <Skeleton className="h-96 w-full rounded-md" />;
  }
  if (doc.isError || !doc.data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState
          title={t('documents.notFound.title')}
          description={t('documents.notFound.description')}
        />
      </div>
    );
  }
  const data = doc.data;

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <PageHeader
        title={data.regNumber ?? data.subject}
        description={data.regNumber ? data.subject : undefined}
        status={
          <span data-testid="document-status" className="flex items-center gap-2">
            <StatusBadge
              tone={documentStatusTone[data.status]}
              label={t(`documentStatus.${data.status}`)}
            />
            {data.confidentiality === 'dsp' ? (
              <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
                {t('documents.dsp')}
              </span>
            ) : null}
          </span>
        }
        actions={
          <div className="flex gap-2">
            {data.canRegister ? (
              <Button size="sm" onClick={() => setRegisterOpen(true)}>
                <FileCheck2 className="size-4" /> {t('documents.register.action')}
              </Button>
            ) : null}
            {data.canChangeStatus ? (
              <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>
                {t('documents.status.action')}
              </Button>
            ) : null}
          </div>
        }
      />

      <Requisites data={data} />
      <RouteSection doc={data} />
      <SignatureSection doc={data} />
      <AcknowledgementSection doc={data} />
      <ResolutionSection doc={data} />
      <Files data={data} />

      {registerOpen ? <RegisterDialog id={data.id} onClose={() => setRegisterOpen(false)} /> : null}
      {statusOpen ? <StatusDialog data={data} onClose={() => setStatusOpen(false)} /> : null}
    </div>
  );

  function BackLink(): React.JSX.Element {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => navigate('/app/docs')}
      >
        <ArrowLeft className="size-4" /> {t('documents.back')}
      </Button>
    );
  }
}

function Requisites({ data }: { data: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const docTypes = useDocumentTypes();
  const typeName =
    docTypes.data?.find((type) => type.code === data.typeCode)?.nameRu ?? data.typeCode;
  const rows: Array<[string, string]> = [
    [t('documents.columns.class'), t(`docClass.${data.docClass}`)],
    [t('documents.form.type'), typeName],
    [t('documents.columns.number'), data.regNumber ?? t('documents.unregistered')],
    [t('documents.card.journal'), data.journalName ?? '—'],
    [t('documents.columns.author'), data.authorName ?? '—'],
    [t('documents.card.orgUnit'), data.orgUnitName ?? '—'],
    [t('documents.card.correspondent'), data.correspondentName ?? '—'],
    [t('documents.card.caseIndex'), data.caseIndex ?? '—'],
    [t('documents.card.regDate'), data.regDate ? formatDateTime(data.regDate) : '—'],
    [t('documents.card.dueDate'), data.dueDate ? formatDateTime(data.dueDate) : '—'],
  ];
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-text">{t('documents.card.overview')}</h2>
      {data.summary ? <p className="mb-4 text-[13px] text-text-muted">{data.summary}</p> : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-border/50 py-1">
            <dt className="text-[13px] text-text-muted">{label}</dt>
            <dd className="text-right text-[13px] text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Files({ data }: { data: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Paperclip className="size-4" /> {t('documents.card.files')}
      </h2>
      {data.files.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('documents.card.noFiles')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 text-[13px] text-text">
              <span className="rounded bg-surface-2 px-1.5 text-[11px] text-text-muted">
                {t(`documents.fileKind.${file.kind}`)}
                {file.kind === 'main' ? ` v${file.version}` : ''}
              </span>
              {file.title ?? file.fileId}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RegisterDialog({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const journals = useJournals();
  const register = useRegisterDocument();
  const [journalId, setJournalId] = useState('');
  const options = useMemo(() => (journals.data ?? []).filter((j) => j.isActive), [journals.data]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const chosen = journalId || options[0]?.id;
    if (!chosen) return;
    register.mutate(
      { id, input: { journalId: chosen } },
      {
        onSuccess: () => {
          toast({ title: t('documents.register.done'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('documents.register.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="register-journal">{t('documents.card.journal')}</Label>
            <select
              id="register-journal"
              className={selectClass}
              value={journalId || options[0]?.id || ''}
              onChange={(e) => setJournalId(e.target.value)}
            >
              {options.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={register.isPending || options.length === 0}>
              {t('documents.register.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  data,
  onClose,
}: {
  data: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const change = useChangeDocumentStatus();
  const targets = DOCUMENT_STATUS_TRANSITIONS[data.status];
  const [target, setTarget] = useState<DocumentStatus | ''>(targets[0] ?? '');
  const [reason, setReason] = useState('');
  const reasonRequired = target === 'rejected' || target === 'recalled';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    change.mutate(
      { id: data.id, input: { status: target, reason: reason.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: t('common.saved'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('documents.status.failed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('documents.status.title')}</DialogTitle>
        </DialogHeader>
        {targets.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t('documents.status.terminal')}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="status-target">{t('documents.status.target')}</Label>
              <select
                id="status-target"
                className={selectClass}
                value={target}
                onChange={(e) => setTarget(e.target.value as DocumentStatus)}
              >
                {targets.map((s) => (
                  <option key={s} value={s}>
                    {t(`documentStatus.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            {reasonRequired ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="status-reason">{t('documents.status.reason')}</Label>
                <Input
                  id="status-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={change.isPending || (reasonRequired && !reason.trim())}
              >
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
