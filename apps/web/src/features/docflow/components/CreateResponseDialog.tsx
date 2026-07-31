import { useState, type FormEvent } from 'react';
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
import type { CreateResponseInput, DocumentDetailDto } from '@cuks/shared';
import { useCreateResponse, useDocumentTypes } from '../api/queries';
import { UserMultiPicker, UserPicker, type PickedUser } from './UserPicker';

const controlClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * «Создать ответ» from an incoming card (docs/modules/11 §12.3).
 *
 * The addressee is not asked for: it comes from the letter being answered, and re-typing it
 * is how the answer ends up addressed to the wrong ministry. Confidentiality is not offered
 * either — the answer inherits the letter's, and the server would refuse anything looser.
 */
export function CreateResponseDialog({
  source,
  onClose,
}: {
  source: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const navigate = useNavigate();
  const types = useDocumentTypes();
  const create = useCreateResponse(source.id);

  const [typeCode, setTypeCode] = useState('letter');
  const [subject, setSubject] = useState('');
  const [preparer, setPreparer] = useState<PickedUser | null>(null);
  const [signer, setSigner] = useState<PickedUser | null>(null);
  const [approvers, setApprovers] = useState<PickedUser[]>([]);
  const [startRoute, setStartRoute] = useState(true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input: CreateResponseInput = {
      typeCode,
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      preparerId: preparer?.id ?? null,
      signerId: signer?.id ?? null,
      approverIds: approvers.map((u) => u.id),
      startRoute,
    };
    create.mutate(input, {
      onSuccess: (created) => {
        toast({ title: t('response.createdToast'), tone: 'success' });
        onClose();
        // Straight to the draft: the point of the action is to start writing it.
        navigate(`/app/docs/${created.id}`);
      },
      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('response.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="rounded-sm bg-surface-2 px-3 py-2 text-xs text-text-muted">
            {t('response.inheritHint', {
              regNumber: source.regNumber ?? '—',
              recipient: source.senderName ?? '—',
            })}
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="response-type">{t('documents.form.type')}</Label>
            <select
              id="response-type"
              className={controlClass}
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
            >
              {(types.data ?? []).map((x) => (
                <option key={x.code} value={x.code}>
                  {x.nameRu}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="response-subject">{t('response.form.subject')}</Label>
            <Input
              id="response-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('response.form.subjectPlaceholder', {
                regNumber: source.regNumber ?? '',
              })}
            />
          </div>

          <UserPicker label={t('response.form.preparer')} value={preparer} onChange={setPreparer} />

          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={startRoute}
              onChange={(e) => setStartRoute(e.target.checked)}
            />
            {t('response.form.startRoute')}
          </label>

          {startRoute ? (
            <>
              <p className="text-xs text-text-muted">{t('response.form.presetHint')}</p>
              <UserMultiPicker
                label={t('response.form.approvers')}
                value={approvers}
                onChange={setApprovers}
              />
              <UserPicker label={t('response.form.signer')} value={signer} onChange={setSigner} />
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('response.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
