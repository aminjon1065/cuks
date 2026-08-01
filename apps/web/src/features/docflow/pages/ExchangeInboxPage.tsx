import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Inbox, Paperclip, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
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
  INBOUND_EXCHANGE_STATUSES,
  type InboundExchangeDto,
  type InboundExchangeStatus,
} from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  useCorrespondents,
  useDocumentTypes,
  useInboundExchange,
  useJournals,
  useRegisterInboundExchange,
  useRejectInboundExchange,
} from '../api/queries';

const PAGE_SIZE = 25;
const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * «Обмен: разбор входящих» (plan этап 10).
 *
 * The screen a person opens to answer exactly what the machine refused to guess: who sent this
 * letter, and what kind of letter it is. Everything else — the number, the date, the audit
 * entry — comes from the ordinary registration, so a letter that arrived through a transport
 * ends up indistinguishable from one carried in on paper.
 *
 * Nothing here can be hurried past the antivirus. A message whose attachments are still being
 * scanned shows why it is waiting and offers no register button — the server refuses it too,
 * so the screen and the API cannot disagree.
 */
export function ExchangeInboxPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('exchangeInbox.title'));
  const [status, setStatus] = useState<InboundExchangeStatus | ''>('');
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState<InboundExchangeDto | null>(null);
  const [rejecting, setRejecting] = useState<InboundExchangeDto | null>(null);

  const query = { page, limit: PAGE_SIZE, ...(status ? { status } : {}) };
  const { data, isPending, isError, refetch } = useInboundExchange(query);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('exchangeInbox.title')} description={t('exchangeInbox.subtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(selectClass, 'w-auto')}
          aria-label={t('exchangeInbox.statusFilter')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InboundExchangeStatus | '');
            setPage(1);
          }}
        >
          {/* The default is «то, что ждёт разбора» — the reason somebody opened this screen. */}
          <option value="">{t('exchangeInbox.filterOpen')}</option>
          {INBOUND_EXCHANGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`exchangeInbox.status.${s}`)}
            </option>
          ))}
        </select>
        {total > 0 ? (
          <span className="text-xs text-text-muted">
            {t('exchangeInbox.count', { count: total })}
          </span>
        ) : null}
      </div>

      {isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={Inbox}
          title={t('exchangeInbox.failedTitle')}
          description={t('exchangeInbox.failedHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t('exchangeInbox.emptyTitle')}
          description={t('exchangeInbox.emptyHint')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              onRegister={() => setRegistering(message)}
              onReject={() => setRejecting(message)}
            />
          ))}
        </ul>
      )}

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-[13px] text-text-muted">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.prev')}
          </Button>
          <span className="tabular-nums">
            {t('exchangeInbox.page', { page, of: Math.ceil(total / PAGE_SIZE) })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}

      {registering ? (
        <RegisterDialog message={registering} onClose={() => setRegistering(null)} />
      ) : null}
      {rejecting ? <RejectDialog message={rejecting} onClose={() => setRejecting(null)} /> : null}
    </div>
  );
}

function MessageCard({
  message,
  onRegister,
  onReject,
}: {
  message: InboundExchangeDto;
  onRegister: () => void;
  onReject: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const open = message.status === 'received' || message.status === 'quarantined';

  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-text">{message.subject}</span>
        <StatusBadge
          tone={
            message.status === 'registered'
              ? 'success'
              : message.status === 'rejected'
                ? 'danger'
                : message.status === 'quarantined'
                  ? 'warning'
                  : 'neutral'
          }
          label={t(`exchangeInbox.status.${message.status}`)}
        />
        <span className="ml-auto text-xs text-text-muted">
          {formatDateTime(message.receivedAt)} · {message.adapterId}
        </span>
      </div>

      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
        <dt className="text-text-muted">{t('exchangeInbox.sender')}</dt>
        <dd className="text-text">
          {message.senderName ?? '—'}
          {message.correspondentName ? (
            <span className="ml-2 text-xs text-success">
              {t('exchangeInbox.matched', { name: message.correspondentName })}
            </span>
          ) : open ? (
            // The question this screen exists to ask, stated where the answer is missing.
            <span className="ml-2 text-xs text-warning">{t('exchangeInbox.unmatched')}</span>
          ) : null}
        </dd>
        {message.documentRegNumber ? (
          <>
            <dt className="text-text-muted">{t('exchangeInbox.document')}</dt>
            <dd>
              <Link
                to={`/app/docs/${message.documentId}`}
                className="font-mono text-primary hover:underline"
              >
                {message.documentRegNumber}
              </Link>
            </dd>
          </>
        ) : null}
        {message.rejectedReason ? (
          <>
            <dt className="text-text-muted">{t('exchangeInbox.rejectedReason')}</dt>
            <dd className="text-text">{message.rejectedReason}</dd>
          </>
        ) : null}
      </dl>

      {message.attachments.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-2 text-xs">
          {message.attachments.map((file) => (
            <li
              key={file.fileId}
              className="inline-flex items-center gap-1 rounded-sm bg-surface-muted px-1.5 py-0.5"
            >
              <Paperclip className="size-3 shrink-0" aria-hidden />
              <span className="text-text">{file.fileName}</span>
              <ScanBadge status={file.avStatus} />
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" disabled={!message.canRegister} onClick={onRegister}>
            {t('exchangeInbox.register')}
          </Button>
          <Button size="sm" variant="outline" onClick={onReject}>
            {t('exchangeInbox.reject')}
          </Button>
          {message.blockedBy ? (
            // Why the button is off, said in words: a disabled control with no explanation is
            // read as a broken screen.
            <span className="text-xs text-text-muted">
              {t(`exchangeInbox.blocked.${message.blockedBy}`)}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ScanBadge({ status }: { status: string | null }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  if (status === 'clean') {
    return (
      <span className="inline-flex items-center gap-0.5 text-success">
        <ShieldCheck className="size-3" aria-hidden /> {t('exchangeInbox.scan.clean')}
      </span>
    );
  }
  if (status === 'infected') {
    return (
      <span className="inline-flex items-center gap-0.5 text-danger">
        <ShieldAlert className="size-3" aria-hidden /> {t('exchangeInbox.scan.infected')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-text-muted">
      <ShieldQuestion className="size-3" aria-hidden /> {t('exchangeInbox.scan.pending')}
    </span>
  );
}

function RegisterDialog({
  message,
  onClose,
}: {
  message: InboundExchangeDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const register = useRegisterInboundExchange();
  const journals = useJournals();
  const types = useDocumentTypes();
  const [search, setSearch] = useState(message.senderName ?? '');
  const correspondents = useCorrespondents(search);

  const [journalId, setJournalId] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [correspondentId, setCorrespondentId] = useState(message.correspondentId ?? '');
  const [subject, setSubject] = useState(message.subject);

  // Only incoming books: an arriving letter is registered in one, and offering the others
  // would be offering a mistake the server then refuses.
  const incomingJournals = (journals.data ?? []).filter(
    (j) => j.docClass === 'incoming' && j.isActive,
  );
  const ready = journalId && typeCode && correspondentId && subject.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('exchangeInbox.registerTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!ready) return;
            register.mutate(
              {
                id: message.id,
                input: {
                  journalId,
                  typeCode,
                  correspondentId,
                  subject: subject.trim(),
                  confidentiality: 'normal',
                },
              },
              {
                onSuccess: (result) => {
                  toast({
                    title: t('exchangeInbox.registeredToast', {
                      number: result.documentRegNumber ?? '',
                    }),
                    tone: 'success',
                  });
                  onClose();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="exch-subject">{t('exchangeInbox.subjectLabel')}</Label>
            <Input
              id="exch-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
            {/* Editable because a transport's subject line is often a file name. */}
            <p className="text-xs text-text-muted">{t('exchangeInbox.subjectHint')}</p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="exch-correspondent">{t('exchangeInbox.correspondentLabel')}</Label>
            <Input
              id="exch-correspondent-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('exchangeInbox.correspondentSearch')}
            />
            <select
              id="exch-correspondent"
              className={selectClass}
              value={correspondentId}
              onChange={(e) => setCorrespondentId(e.target.value)}
              required
            >
              <option value="">{t('exchangeInbox.correspondentPick')}</option>
              {(correspondents.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted">
              {t('exchangeInbox.senderStated', { name: message.senderName ?? '—' })}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="exch-journal">{t('exchangeInbox.journalLabel')}</Label>
            <select
              id="exch-journal"
              className={selectClass}
              value={journalId}
              onChange={(e) => setJournalId(e.target.value)}
              required
            >
              <option value="">{t('exchangeInbox.journalPick')}</option>
              {incomingJournals.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="exch-type">{t('exchangeInbox.typeLabel')}</Label>
            <select
              id="exch-type"
              className={selectClass}
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
              required
            >
              <option value="">{t('exchangeInbox.typePick')}</option>
              {(types.data ?? []).map((type) => (
                <option key={type.code} value={type.code}>
                  {type.nameRu}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!ready || register.isPending}>
              {t('exchangeInbox.register')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  message,
  onClose,
}: {
  message: InboundExchangeDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const reject = useRejectInboundExchange();
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('exchangeInbox.rejectTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!reason.trim()) return;
            reject.mutate(
              { id: message.id, input: { reason: reason.trim() } },
              {
                onSuccess: () => {
                  toast({ title: t('exchangeInbox.rejectedToast'), tone: 'success' });
                  onClose();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="rounded-sm bg-warning/10 px-3 py-2 text-[13px] text-warning">
            {t('exchangeInbox.rejectWarning')}
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="exch-reason">{t('exchangeInbox.reasonLabel')}</Label>
            <Input
              id="exch-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!reason.trim() || reject.isPending}>
              {t('exchangeInbox.reject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
