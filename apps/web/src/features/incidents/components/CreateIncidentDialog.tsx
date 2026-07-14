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
import type { CreateIncidentInput, IncidentMapFilterOptionsResponse } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { dushanbeDateTimeLocal, dushanbeDateTimeToIso } from '../lib';
import { useCreateIncident } from '../api/queries';
import { IncidentLocationPicker } from './IncidentLocationPicker';

const DEFAULT_LOCATION = { longitude: 68.787, latitude: 38.559 };

function optionalCount(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

export function CreateIncidentDialog({
  open,
  onOpenChange,
  options,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  options: IncidentMapFilterOptionsResponse | undefined;
  onCreated: (id: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation('incidents');
  const create = useCreateIncident();
  const [typeCode, setTypeCode] = useState('');
  const [severity, setSeverity] = useState('1');
  const [occurredAt, setOccurredAt] = useState(() => dushanbeDateTimeLocal());
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [addressText, setAddressText] = useState('');
  const [description, setDescription] = useState('');
  const [dead, setDead] = useState('');
  const [injured, setInjured] = useState('');
  const [evacuated, setEvacuated] = useState('');
  const [affected, setAffected] = useState('');

  const reset = (): void => {
    setTypeCode('');
    setSeverity('1');
    setOccurredAt(dushanbeDateTimeLocal());
    setLocation(DEFAULT_LOCATION);
    setAddressText('');
    setDescription('');
    setDead('');
    setInjured('');
    setEvacuated('');
    setAffected('');
  };
  const close = (): void => {
    onOpenChange(false);
    reset();
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    let input: CreateIncidentInput;
    try {
      input = {
        typeCode,
        severity: Number(severity) as CreateIncidentInput['severity'],
        occurredAt: dushanbeDateTimeToIso(occurredAt),
        location,
        ...(addressText.trim() ? { addressText: addressText.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        source: 'phone',
        dead: optionalCount(dead) ?? 0,
        injured: optionalCount(injured) ?? 0,
        evacuated: optionalCount(evacuated) ?? 0,
        affected: optionalCount(affected) ?? 0,
      };
    } catch {
      toast({ title: t('form.invalidDate'), tone: 'danger' });
      return;
    }
    create.mutate(input, {
      onSuccess: (incident) => {
        toast({ title: t('form.created'), tone: 'success' });
        close();
        onCreated(incident.id);
      },
      onError: (error) =>
        toast({
          title: error instanceof ApiError ? error.message : t('form.createFailed'),
          tone: 'danger',
        }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent
        closeLabel={t('actions.close')}
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="incident-type" required>
                {t('form.type')}
              </Label>
              <select
                id="incident-type"
                value={typeCode}
                onChange={(event) => setTypeCode(event.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <option value="">{t('form.typePlaceholder')}</option>
                {options?.types.map((item) => {
                  const parent =
                    i18n.resolvedLanguage === 'tg' ? item.parentNameTg : item.parentNameRu;
                  const name = i18n.resolvedLanguage === 'tg' ? item.nameTg : item.nameRu;
                  return (
                    <option key={item.code} value={item.code}>
                      {parent ? `${parent} — ${name}` : name}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incident-severity" required>
                {t('form.severity')}
              </Label>
              <select
                id="incident-severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {[1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {t(`severity.${level}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="incident-occurred-at" required>
              {t('form.occurredAt')}
            </Label>
            <Input
              id="incident-occurred-at"
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('form.location')}</Label>
            <IncidentLocationPicker
              value={location}
              onChange={setLocation}
              ariaLabel={t('form.mapPicker')}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="incident-longitude">{t('form.longitude')}</Label>
                <Input
                  id="incident-longitude"
                  type="number"
                  step="any"
                  value={location.longitude}
                  onChange={(event) =>
                    setLocation((value) => ({ ...value, longitude: Number(event.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="incident-latitude">{t('form.latitude')}</Label>
                <Input
                  id="incident-latitude"
                  type="number"
                  step="any"
                  value={location.latitude}
                  onChange={(event) =>
                    setLocation((value) => ({ ...value, latitude: Number(event.target.value) }))
                  }
                />
              </div>
            </div>
            <p className="text-xs text-text-muted">{t('form.locationHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="incident-address">{t('form.address')}</Label>
            <Input
              id="incident-address"
              value={addressText}
              onChange={(event) => setAddressText(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident-description">{t('form.description')}</Label>
            <textarea
              id="incident-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-20 w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('form.preliminary')}</Label>
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
                  <Label htmlFor={`incident-${key}`}>{t(`figures.${key}`)}</Label>
                  <Input
                    id={`incident-${key}`}
                    type="number"
                    min="0"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              data-testid="incidents-create-submit"
              disabled={!typeCode || create.isPending}
            >
              {t('form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
