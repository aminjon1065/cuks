import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  cn,
  toast,
} from '@cuks/ui';
import type { DocumentDetailDto, UpdateDocumentInput } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useDocumentTypes, useUpdateDocument } from '../api/queries';
import { CorrespondentCombobox } from './CorrespondentCombobox';

const fieldClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** `2026-07-31T06:00:00.000Z` → `2026-07-31` for a native date input. */
function toDateInput(iso: string | null): string {
  return iso ? (iso.split('T')[0] ?? '') : '';
}
/** A date input value → an ISO instant, or null when cleared. */
function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

/**
 * Edit a document's requisites (docs/modules/11 §12.5). Which fields matter depends on the
 * class: an incoming letter carries a sender, an outgoing one a recipient, an internal one
 * neither. The dialog submits `expectedVersion`, so a save that lost a race is reported as
 * a conflict to reload rather than silently overwriting the other editor.
 */
export function EditDocumentDialog({
  doc,
  onClose,
}: {
  doc: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const types = useDocumentTypes();
  const update = useUpdateDocument();
  const [conflict, setConflict] = useState(false);

  const [typeCode, setTypeCode] = useState(doc.typeCode);
  const [subject, setSubject] = useState(doc.subject);
  const [summary, setSummary] = useState(doc.summary ?? '');
  const [correspondentId, setCorrespondentId] = useState(doc.correspondentId);
  const [correspondentName, setCorrespondentName] = useState(doc.correspondentName);
  const [senderName, setSenderName] = useState(doc.senderName ?? '');
  const [senderContact, setSenderContact] = useState(doc.senderContact ?? '');
  const [recipientName, setRecipientName] = useState(doc.recipientName ?? '');
  const [recipientContact, setRecipientContact] = useState(doc.recipientContact ?? '');
  const [outgoingNumber, setOutgoingNumber] = useState(doc.outgoingNumber ?? '');
  const [outgoingDate, setOutgoingDate] = useState(toDateInput(doc.outgoingDate));
  const [dueDate, setDueDate] = useState(toDateInput(doc.dueDate));
  const [responseDueAt, setResponseDueAt] = useState(toDateInput(doc.responseDueAt));

  const showSender = doc.docClass === 'incoming' || doc.docClass === 'citizens';
  const showRecipient = doc.docClass === 'outgoing';
  const showCounterparty = showSender || showRecipient;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || update.isPending) return;
    const input: UpdateDocumentInput = {
      expectedVersion: doc.version,
      typeCode,
      subject: subject.trim(),
      summary: summary.trim() || null,
      correspondentId,
      outgoingNumber: outgoingNumber.trim() || null,
      outgoingDate: fromDateInput(outgoingDate),
      dueDate: fromDateInput(dueDate),
      responseDueAt: fromDateInput(responseDueAt),
      senderName: showSender ? senderName.trim() || null : null,
      senderContact: showSender ? senderContact.trim() || null : null,
      recipientName: showRecipient ? recipientName.trim() || null : null,
      recipientContact: showRecipient ? recipientContact.trim() || null : null,
    };
    update.mutate(
      { id: doc.id, input },
      {
        onSuccess: () => {
          toast({ title: t('documents.edit.saved'), tone: 'success' });
          onClose();
        },
        onError: (error) => {
          // A stale save is a first-class outcome, not a generic failure: the other
          // editor's work is intact and this one must reload before trying again.
          if (error instanceof ApiError && error.code === 'docflow.document.version_conflict') {
            setConflict(true);
            return;
          }
          toast({ title: t('common.actionFailed'), tone: 'danger' });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('documents.edit.title')}</DialogTitle>
        </DialogHeader>
        {conflict ? (
          <p role="alert" className="rounded-sm bg-warning/10 px-3 py-2 text-[13px] text-warning">
            {t('documents.edit.conflict')}
          </p>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="edit-type">{t('documents.card.type')}</Label>
              <select
                id="edit-type"
                className={fieldClass}
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value)}
              >
                {(types.data ?? []).map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.nameRu}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="edit-due">{t('documents.card.dueDate')}</Label>
              <input
                id="edit-due"
                type="date"
                className={fieldClass}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-subject">{t('register.wizard.subject')}</Label>
            <Input
              id="edit-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-summary">{t('documents.edit.summary')}</Label>
            <textarea
              id="edit-summary"
              rows={3}
              className={cn(fieldClass, 'h-auto py-2')}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          {showCounterparty ? (
            <>
              <div className="flex flex-col gap-1">
                <Label>{t('register.wizard.correspondent')}</Label>
                <CorrespondentCombobox
                  value={correspondentId}
                  valueName={correspondentName}
                  onChange={(id, name) => {
                    setCorrespondentId(id);
                    setCorrespondentName(name);
                  }}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="edit-party-name">
                    {showSender
                      ? t('documents.edit.senderName')
                      : t('documents.edit.recipientName')}
                  </Label>
                  <Input
                    id="edit-party-name"
                    value={showSender ? senderName : recipientName}
                    onChange={(e) =>
                      showSender ? setSenderName(e.target.value) : setRecipientName(e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="edit-party-contact">{t('documents.edit.contact')}</Label>
                  <Input
                    id="edit-party-contact"
                    value={showSender ? senderContact : recipientContact}
                    onChange={(e) =>
                      showSender
                        ? setSenderContact(e.target.value)
                        : setRecipientContact(e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="edit-outnum">{t('register.wizard.outgoingNumber')}</Label>
                  <Input
                    id="edit-outnum"
                    value={outgoingNumber}
                    onChange={(e) => setOutgoingNumber(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="edit-outdate">{t('register.wizard.outgoingDate')}</Label>
                  <input
                    id="edit-outdate"
                    type="date"
                    className={fieldClass}
                    value={outgoingDate}
                    onChange={(e) => setOutgoingDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="edit-response-due">{t('documents.edit.responseDueAt')}</Label>
                  <input
                    id="edit-response-due"
                    type="date"
                    className={fieldClass}
                    value={responseDueAt}
                    onChange={(e) => setResponseDueAt(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending || !subject.trim() || conflict}>
              {t('documents.edit.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
