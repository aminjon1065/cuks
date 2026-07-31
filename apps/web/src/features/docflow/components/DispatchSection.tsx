import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Paperclip, RotateCcw, Send, X } from 'lucide-react';
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
  Skeleton,
  StatusBadge,
  cn,
  toast,
  type BadgeProps,
} from '@cuks/ui';
import {
  DISPATCH_CHANNELS,
  MANUAL_DISPATCH_CHANNELS,
  type DispatchChannel,
  type DispatchStatus,
  type DocumentDetailDto,
  type DocumentDispatchDto,
  type FsNodeDto,
} from '@cuks/shared';
import { AttachmentField } from '@/features/uploads';
import { formatDateTime } from '@/lib/format';
import { useCreateDispatch, useDispatchAction, useDocumentDispatches } from '../api/queries';
import { documentFileDownloadUrl } from '../lib/document';

const controlClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

const statusTone: Record<DispatchStatus, NonNullable<BadgeProps['tone']>> = {
  pending: 'warning',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/**
 * «Отправка» — how a registered outgoing document actually left (docs/modules/11 §12.1).
 *
 * The whole attempt log is shown, not just the last one: «ушло 12-го» and «первая попытка
 * вернулась 10-го» are both facts the chancellery answers for, and a panel that showed only
 * the success would quietly erase the second. A retry opens a new attempt beside the spent
 * one rather than reviving it.
 */
export function DispatchSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentDispatches(doc.id);
  const canDispatch = doc.availableActions.includes('dispatch');
  const [creating, setCreating] = useState(false);
  const attempts = query.data ?? [];

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Send className="size-4" /> {t('dispatch.title')}
        </h2>
        {canDispatch ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Send className="size-4" /> {t('dispatch.add')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-20 w-full rounded-md" />
      ) : query.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : attempts.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          {doc.docClass !== 'outgoing'
            ? // An internal document is distributed by acquaintance and an incoming one
              // arrived here — neither is ever dispatched, at any status.
              t('dispatch.notApplicable')
            : doc.regNumber
              ? t('dispatch.empty')
              : t('dispatch.emptyUnregistered')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attempts.map((d) => (
            <li key={d.id}>
              <AttemptCard documentId={doc.id} attempt={d} />
            </li>
          ))}
        </ul>
      )}

      {creating ? <CreateDispatchDialog doc={doc} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}

function AttemptCard({
  documentId,
  attempt: d,
}: {
  documentId: string;
  attempt: DocumentDispatchDto;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const act = useDispatchAction(documentId);
  const [confirming, setConfirming] = useState(false);
  const [failing, setFailing] = useState(false);

  const run = (action: 'cancel' | 'retry', successKey: string) =>
    act.mutate(
      { dispatchId: d.id, action },
      {
        onSuccess: () => toast({ title: t(successKey), tone: 'success' }),
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );

  return (
    <div className="rounded-sm border border-border/60 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone={statusTone[d.status]} label={t(`dispatchStatus.${d.status}`)} />
        <span className="text-[13px] font-medium text-text">
          {t(`dispatchChannel.${d.channel}`)}
        </span>
        <span className="text-[13px] text-text">{d.recipientName}</span>
        <span className="ml-auto text-xs text-text-muted">
          {d.sentAt
            ? t('dispatch.sentAt', { date: formatDateTime(d.sentAt) })
            : d.attemptedAt
              ? t('dispatch.attemptedAt', { date: formatDateTime(d.attemptedAt) })
              : ''}
        </span>
      </div>

      {d.recipientAddress ? <p className="text-xs text-text-muted">{d.recipientAddress}</p> : null}
      {d.externalReference ? (
        <p className="mt-0.5 text-xs text-text-muted">
          {t('dispatch.reference')}: <span className="font-mono">{d.externalReference}</span>
        </p>
      ) : null}
      {d.note ? <p className="mt-0.5 text-xs text-text-muted">{d.note}</p> : null}
      {d.failureMessage ? (
        <p className="mt-1 rounded-sm bg-danger/10 px-2 py-1 text-xs text-text">
          {t('dispatch.failure')}: {d.failureMessage}
        </p>
      ) : null}
      {d.receipt ? (
        // The download endpoint serves only a `clean` version, so a link on a pending or
        // infected scan would drop the operator on a raw 403 outside the SPA — the file
        // section states the verdict instead, and so does this one.
        d.receipt.avStatus === 'clean' ? (
          <a
            href={documentFileDownloadUrl(documentId, d.receipt.fileId)}
            className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Paperclip className="size-3.5" /> {d.receipt.name}
          </a>
        ) : (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
            <Paperclip className="size-3.5" /> {d.receipt.name}
            <StatusBadge
              tone={d.receipt.avStatus === 'infected' ? 'danger' : 'warning'}
              label={t(
                d.receipt.avStatus === 'infected'
                  ? 'documents.files.infected'
                  : 'documents.files.scanning',
              )}
            />
          </p>
        )
      ) : null}
      <p className="mt-0.5 text-xs text-text-muted">
        {t('dispatch.by', { name: d.confirmedByName ?? d.createdByName ?? '—' })}
      </p>

      {d.canAct ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.status === 'pending' ? (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => setConfirming(true)}>
                <Check className="size-3.5" /> {t('dispatch.confirmAction')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => setFailing(true)}
              >
                {t('dispatch.failAction')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => run('cancel', 'dispatch.cancelledToast')}
              >
                <X className="size-3.5" /> {t('dispatch.cancelAction')}
              </Button>
            </>
          ) : null}
          {d.status === 'failed' || d.status === 'cancelled' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => run('retry', 'dispatch.retriedToast')}
            >
              <RotateCcw className="size-3.5" /> {t('dispatch.retryAction')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          initialReference={d.externalReference ?? ''}
          pending={act.isPending}
          onClose={() => setConfirming(false)}
          onSubmit={(body) =>
            act.mutate(
              { dispatchId: d.id, action: 'confirm', body },
              {
                onSuccess: () => {
                  toast({ title: t('dispatch.sentToast'), tone: 'success' });
                  setConfirming(false);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}
      {failing ? (
        <FailDialog
          pending={act.isPending}
          onClose={() => setFailing(false)}
          onSubmit={(failureMessage) =>
            act.mutate(
              { dispatchId: d.id, action: 'fail', body: { failureCode: 'manual', failureMessage } },
              {
                onSuccess: () => {
                  toast({ title: t('dispatch.failedToast'), tone: 'success' });
                  setFailing(false);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function CreateDispatchDialog({
  doc,
  onClose,
}: {
  doc: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const create = useCreateDispatch(doc.id);
  const [channel, setChannel] = useState<DispatchChannel>('postal');
  // Prefilled from the card, but editable — the envelope may go somewhere else than the
  // directory says, and the record must match what actually happened.
  const [recipientName, setRecipientName] = useState(doc.recipientName ?? '');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientContact, setRecipientContact] = useState(doc.recipientContact ?? '');
  const [externalReference, setExternalReference] = useState('');
  const [note, setNote] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!recipientName.trim()) return;
    create.mutate(
      {
        channel,
        recipientName: recipientName.trim(),
        recipientAddress: recipientAddress.trim() || null,
        recipientContact: recipientContact.trim() || null,
        externalReference: externalReference.trim() || null,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          toast({ title: t('dispatch.createdToast'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('dispatch.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-channel">{t('dispatch.form.channel')}</Label>
            <select
              id="dispatch-channel"
              className={controlClass}
              value={channel}
              onChange={(e) => setChannel(e.target.value as DispatchChannel)}
            >
              {DISPATCH_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`dispatchChannel.${c}`)}
                </option>
              ))}
            </select>
            {!MANUAL_DISPATCH_CHANNELS.includes(channel) ? (
              // Machine channels need a locally configured adapter; without one the server
              // refuses rather than accepting a send that would never happen.
              <p className="text-xs text-warning">{t('dispatch.form.adapterHint')}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-recipient">{t('dispatch.form.recipient')}</Label>
            <Input
              id="dispatch-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-address">{t('dispatch.form.address')}</Label>
            <Input
              id="dispatch-address"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-contact">{t('dispatch.form.contact')}</Label>
            <Input
              id="dispatch-contact"
              value={recipientContact}
              onChange={(e) => setRecipientContact(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-reference">{t('dispatch.form.reference')}</Label>
            <Input
              id="dispatch-reference"
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-note">{t('dispatch.form.note')}</Label>
            <Input id="dispatch-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !recipientName.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  initialReference,
  onClose,
  onSubmit,
  pending,
}: {
  /** Whatever the attempt already carries — an empty field here must not erase it. */
  initialReference: string;
  onClose: () => void;
  onSubmit: (body: { externalReference: string | null; receiptFileId: string | null }) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [reference, setReference] = useState(initialReference);
  const [receiptFileId, setReceiptFileId] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dispatch.confirmAction')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ externalReference: reference.trim() || null, receiptFileId });
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-confirm-reference">{t('dispatch.form.reference')}</Label>
            <Input
              id="dispatch-confirm-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-receipt">{t('dispatch.form.receipt')}</Label>
            <AttachmentField
              target={{ space: 'personal' }}
              multiple={false}
              onChange={(nodes: FsNodeDto[]) => setReceiptFileId(nodes[0]?.id ?? null)}
            />
            <p className="text-xs text-text-muted">{t('dispatch.form.receiptHint')}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('dispatch.confirmAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FailDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (message: string) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [message, setMessage] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dispatch.failAction')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) onSubmit(message.trim());
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispatch-failure">{t('dispatch.failure')}</Label>
            <Input
              id="dispatch-failure"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('dispatch.form.failureHint')}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !message.trim()}>
              {t('dispatch.failAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
