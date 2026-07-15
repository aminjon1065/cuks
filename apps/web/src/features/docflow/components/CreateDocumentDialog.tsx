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
import { DOC_CLASSES, type CreateDocumentInput, type DocClass } from '@cuks/shared';
import { useCreateDocument, useDocumentTypes } from '../api/queries';

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export interface CreateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function CreateDocumentDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateDocumentDialogProps): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const create = useCreateDocument();
  const docTypes = useDocumentTypes();
  const [docClass, setDocClass] = useState<DocClass>('internal');
  const [typeCode, setTypeCode] = useState('');
  const [subject, setSubject] = useState('');
  const [summary, setSummary] = useState('');
  const [confidential, setConfidential] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input: CreateDocumentInput = {
      docClass,
      typeCode: typeCode || (docTypes.data?.[0]?.code ?? 'letter'),
      subject: subject.trim(),
      summary: summary.trim() || null,
      confidentiality: confidential ? 'dsp' : 'normal',
    };
    create.mutate(input, {
      onSuccess: (doc) => {
        toast({ title: t('common.saved'), tone: 'success' });
        onOpenChange(false);
        onCreated(doc.id);
      },
      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('documents.create.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-class">{t('documents.form.class')}</Label>
            <select
              id="doc-class"
              className={selectClass}
              value={docClass}
              onChange={(e) => setDocClass(e.target.value as DocClass)}
            >
              {DOC_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {t(`docClass.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-type">{t('documents.form.type')}</Label>
            <select
              id="doc-type"
              className={selectClass}
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
            >
              {(docTypes.data ?? []).map((type) => (
                <option key={type.code} value={type.code}>
                  {type.nameRu}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-subject">{t('documents.form.subject')}</Label>
            <Input
              id="doc-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-summary">{t('documents.form.summary')}</Label>
            <Input id="doc-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
            />
            {t('documents.form.confidential')}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !subject.trim()}>
              {t('documents.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
