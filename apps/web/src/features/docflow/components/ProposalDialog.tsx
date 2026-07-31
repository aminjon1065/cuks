import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  cn,
  toast,
} from '@cuks/ui';
import type {
  CreateResolutionProposalInput,
  ResolutionProposalDto,
  ResolutionTypeDto,
} from '@cuks/shared';
import { useCreateProposal, useResolutionTypes, useUpdateProposal } from '../api/queries';
import { UserMultiPicker, UserPicker, type PickedUser } from './UserPicker';

const controlClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** `datetime-local` wants a local wall-clock string, and the API an instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Draft or edit a resolution for a signer to decide (docs/modules/11 §12.11).
 *
 * The type drives what the form insists on — «Исполнить» wants an executor and a deadline,
 * «Ознакомить» wants neither — so the chancellery cannot submit an instruction that the
 * signer would have to reject on a technicality. The `acquaint` list is the pre-execution
 * gate: those people read the document BEFORE the executors see their instruction.
 */
export function ProposalDialog(props: {
  documentId: string;
  /** Editing an existing draft, or null for a new one. */
  value: ResolutionProposalDto | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const types = useResolutionTypes(true);
  const create = useCreateProposal(props.documentId);
  const update = useUpdateProposal(props.documentId);
  const editing = props.value;

  const [typeId, setTypeId] = useState(editing?.resolutionTypeId ?? '');
  const [text, setText] = useState(editing?.text ?? '');
  const [signer, setSigner] = useState<PickedUser | null>(
    editing ? { id: editing.signerId, name: editing.signerName ?? '—' } : null,
  );
  const [executor, setExecutor] = useState<PickedUser | null>(
    editing?.responsibleExecutorId
      ? { id: editing.responsibleExecutorId, name: editing.responsibleExecutorName ?? '—' }
      : null,
  );
  const [coExecutors, setCoExecutors] = useState<PickedUser[]>([]);
  const [readers, setReaders] = useState<PickedUser[]>([]);
  const [due, setDue] = useState(toLocalInput(editing?.dueAt ?? null));
  const [isControl, setIsControl] = useState(editing?.isControl ?? false);

  const type: ResolutionTypeDto | undefined = (types.data ?? []).find((x) => x.id === typeId);
  const pending = create.isPending || update.isPending;

  /** Picking a type pre-fills what it usually implies, without locking the operator in. */
  const pickType = (id: string) => {
    setTypeId(id);
    const next = (types.data ?? []).find((x) => x.id === id);
    if (!next) return;
    setIsControl(next.defaultControl);
    if (next.defaultDueHours && !due) {
      setDue(toLocalInput(new Date(Date.now() + next.defaultDueHours * 3600_000).toISOString()));
    }
  };

  const missingExecutor = !!type?.requiresExecutor && !executor;
  const missingDue = !!type?.requiresDueAt && !due;
  const canSubmit = !!text.trim() && !!signer && !missingExecutor && !missingDue && !pending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!signer || !text.trim()) return;
    const input: CreateResolutionProposalInput = {
      text: text.trim(),
      signerId: signer.id,
      resolutionTypeId: typeId || null,
      responsibleExecutorId: executor?.id ?? null,
      coExecutorIds: coExecutors.map((u) => u.id),
      acquaintUserIds: readers.map((u) => u.id),
      dueAt: due ? new Date(due).toISOString() : null,
      isControl,
    };
    const onSuccess = () => {
      toast({ title: t('proposals.savedToast'), tone: 'success' });
      props.onClose();
    };
    const onError = () => toast({ title: t('common.actionFailed'), tone: 'danger' });
    if (editing) update.mutate({ id: editing.id, input }, { onSuccess, onError });
    else create.mutate(input, { onSuccess, onError });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('proposals.form.editTitle') : t('proposals.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="proposal-type">{t('proposals.form.type')}</Label>
            <select
              id="proposal-type"
              className={controlClass}
              value={typeId}
              onChange={(e) => pickType(e.target.value)}
            >
              <option value="">{t('proposals.form.noType')}</option>
              {(types.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nameRu}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="proposal-text">{t('proposals.form.text')}</Label>
            <textarea
              id="proposal-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              rows={3}
              className={cn(controlClass, 'h-auto py-2')}
            />
          </div>

          <UserPicker
            label={t('proposals.form.signer')}
            value={signer}
            onChange={setSigner}
            required
          />

          <UserPicker
            label={t(
              type?.requiresExecutor
                ? 'proposals.form.executor'
                : 'proposals.form.executorOptional',
            )}
            value={executor}
            onChange={setExecutor}
          />
          {missingExecutor ? (
            <p className="text-xs text-danger">{t('proposals.form.executorRequired')}</p>
          ) : null}

          <UserMultiPicker
            label={t('proposals.form.coExecutors')}
            value={coExecutors}
            onChange={setCoExecutors}
            exclude={executor ? [executor.id] : []}
          />

          <UserMultiPicker
            label={t('proposals.form.readers')}
            hint={t('proposals.form.readersHint')}
            value={readers}
            onChange={setReaders}
          />

          <div className="flex flex-col gap-1">
            <Label htmlFor="proposal-due">{t('proposals.form.due')}</Label>
            <input
              id="proposal-due"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className={controlClass}
            />
            {missingDue ? (
              <p className="text-xs text-danger">{t('proposals.form.dueRequired')}</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={isControl}
              onChange={(e) => setIsControl(e.target.checked)}
            />
            {t('resolutions.form.control')}
          </label>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
