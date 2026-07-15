import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import type { FsNodeDto } from '@cuks/shared';
import { AttachmentField } from '@/features/uploads';
import { api } from '@/lib/api-client';
import { useCreateDocument, useJournals, useRegisterDocument } from '../api/queries';
import { CorrespondentCombobox } from './CorrespondentCombobox';

const inputClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * Incoming-document registration wizard (docs/modules/11 §4/§7 — «60 секунд»): scan/file
 * → correspondent (search or create inline) → their number/date → subject → journal. On
 * submit it creates the draft, attaches the file, and registers it in one flow, then opens
 * the freshly-numbered card ready for a resolution.
 */
export function RegisterWizard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const navigate = useNavigate();
  const journals = useJournals();
  const create = useCreateDocument();
  const register = useRegisterDocument();

  const [fileNodeId, setFileNodeId] = useState<string | null>(null);
  const [correspondentId, setCorrespondentId] = useState<string | null>(null);
  const [correspondentName, setCorrespondentName] = useState<string | null>(null);
  const [outgoingNumber, setOutgoingNumber] = useState('');
  const [outgoingDate, setOutgoingDate] = useState('');
  const [subject, setSubject] = useState('');
  const [journalId, setJournalId] = useState('');
  const [busy, setBusy] = useState(false);

  const incomingJournals = useMemo(
    () => (journals.data ?? []).filter((j) => j.isActive && j.docClass === 'incoming'),
    [journals.data],
  );
  const chosenJournal = journalId || incomingJournals[0]?.id || '';

  const onFiles = (nodes: FsNodeDto[]) => setFileNodeId(nodes[0]?.id ?? null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !chosenJournal || busy) return;
    setBusy(true);
    try {
      const doc = await create.mutateAsync({
        docClass: 'incoming',
        typeCode: 'letter',
        subject: subject.trim(),
        confidentiality: 'normal',
        ...(correspondentId ? { correspondentId } : {}),
        ...(outgoingNumber.trim() ? { outgoingNumber: outgoingNumber.trim() } : {}),
        ...(outgoingDate ? { outgoingDate: new Date(outgoingDate).toISOString() } : {}),
      });
      if (fileNodeId) {
        await api.post(`/v1/docflow/documents/${doc.id}/files`, {
          fileId: fileNodeId,
          kind: 'main',
        });
      }
      await register.mutateAsync({ id: doc.id, input: { journalId: chosenJournal } });
      toast({ title: t('register.wizard.done'), tone: 'success' });
      onClose();
      navigate(`/app/docs/${doc.id}`);
    } catch {
      toast({ title: t('register.wizard.failed'), tone: 'danger' });
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('register.wizard.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>{t('register.wizard.file')}</Label>
            <AttachmentField target={{ space: 'personal' }} multiple={false} onChange={onFiles} />
          </div>

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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="wizard-outnum">{t('register.wizard.outgoingNumber')}</Label>
              <Input
                id="wizard-outnum"
                value={outgoingNumber}
                onChange={(e) => setOutgoingNumber(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wizard-outdate">{t('register.wizard.outgoingDate')}</Label>
              <input
                id="wizard-outdate"
                type="date"
                value={outgoingDate}
                onChange={(e) => setOutgoingDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="wizard-subject">{t('register.wizard.subject')}</Label>
            <Input
              id="wizard-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="wizard-journal">{t('documents.card.journal')}</Label>
            <select
              id="wizard-journal"
              className={inputClass}
              value={chosenJournal}
              onChange={(e) => setJournalId(e.target.value)}
            >
              {incomingJournals.length === 0 ? (
                <option value="">{t('register.wizard.noJournal')}</option>
              ) : (
                incomingJournals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !subject.trim() || !chosenJournal}>
              {t('register.wizard.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
