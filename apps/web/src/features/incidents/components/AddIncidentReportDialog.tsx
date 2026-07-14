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
  toast,
} from '@cuks/ui';
import type { CreateIncidentReportInput } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { dushanbeDateTimeLocal, dushanbeDateTimeToIso } from '../lib';
import { useCreateIncidentReport } from '../api/queries';

function optionalCount(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

export function AddIncidentReportDialog({
  incidentId,
  open,
  onOpenChange,
}: {
  incidentId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('incidents');
  const create = useCreateIncidentReport();
  const [reportedAt, setReportedAt] = useState(() => dushanbeDateTimeLocal());
  const [reportedAtTouched, setReportedAtTouched] = useState(false);
  const [text, setText] = useState('');
  const [dead, setDead] = useState('');
  const [injured, setInjured] = useState('');
  const [evacuated, setEvacuated] = useState('');
  const [affected, setAffected] = useState('');
  const [damageEst, setDamageEst] = useState('');
  const [damageNote, setDamageNote] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    let input: CreateIncidentReportInput;
    try {
      input = {
        ...(reportedAtTouched ? { reportedAt: dushanbeDateTimeToIso(reportedAt) } : {}),
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(dead.trim() ? { dead: optionalCount(dead) } : {}),
        ...(injured.trim() ? { injured: optionalCount(injured) } : {}),
        ...(evacuated.trim() ? { evacuated: optionalCount(evacuated) } : {}),
        ...(affected.trim() ? { affected: optionalCount(affected) } : {}),
        ...(damageEst.trim() ? { damageEst: damageEst.trim() } : {}),
        ...(damageNote.trim() ? { damageNote: damageNote.trim() } : {}),
      };
    } catch {
      toast({ title: t('form.invalidDate'), tone: 'danger' });
      return;
    }
    create.mutate(
      { id: incidentId, input },
      {
        onSuccess: () => {
          toast({ title: t('card.reportAdded'), tone: 'success' });
          onOpenChange(false);
          setReportedAt(dushanbeDateTimeLocal());
          setReportedAtTouched(false);
          setText('');
          setDead('');
          setInjured('');
          setEvacuated('');
          setAffected('');
          setDamageEst('');
          setDamageNote('');
        },
        onError: (error) =>
          toast({
            title: error instanceof ApiError ? error.message : t('card.reportFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('card.addReport')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="report-at" required>
              {t('card.reportedAt')}
            </Label>
            <Input
              id="report-at"
              type="datetime-local"
              value={reportedAt}
              onChange={(event) => {
                setReportedAt(event.target.value);
                setReportedAtTouched(true);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-text">{t('card.reportText')}</Label>
            <textarea
              id="report-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-24 w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                { key: 'dead', value: dead, setValue: setDead },
                { key: 'injured', value: injured, setValue: setInjured },
                { key: 'evacuated', value: evacuated, setValue: setEvacuated },
                { key: 'affected', value: affected, setValue: setAffected },
              ] as const
            ).map(({ key, value, setValue }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`report-${key}`}>{t(`figures.${key}`)}</Label>
                <Input
                  id={`report-${key}`}
                  type="number"
                  min="0"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-damage">{t('card.damage')}</Label>
              <Input
                id="report-damage"
                inputMode="decimal"
                value={damageEst}
                onChange={(event) => setDamageEst(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-damage-note">{t('card.damageNote')}</Label>
              <Input
                id="report-damage-note"
                value={damageNote}
                onChange={(event) => setDamageNote(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                create.isPending ||
                (!text.trim() &&
                  !dead.trim() &&
                  !injured.trim() &&
                  !evacuated.trim() &&
                  !affected.trim() &&
                  !damageEst.trim() &&
                  !damageNote.trim())
              }
            >
              {t('card.addReport')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
