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
import type { CreateIncidentResourceInput, IncidentResourceKind } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useCreateIncidentResource } from '../api/queries';

export function AddIncidentResourceDialog({
  incidentId,
  open,
  onOpenChange,
}: {
  incidentId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('incidents');
  const create = useCreateIncidentResource();
  const [kind, setKind] = useState<IncidentResourceKind>('personnel');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [orgText, setOrgText] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const input: CreateIncidentResourceInput = {
      kind,
      name: name.trim(),
      qty: Number(qty),
      ...(orgText.trim() ? { orgText: orgText.trim() } : {}),
    };
    create.mutate(
      { id: incidentId, input },
      {
        onSuccess: () => {
          toast({ title: t('card.resourceAdded'), tone: 'success' });
          onOpenChange(false);
          setName('');
          setQty('1');
          setOrgText('');
        },
        onError: (error) =>
          toast({
            title: error instanceof ApiError ? error.message : t('card.resourceFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('card.addResource')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resource-kind" required>
              {t('card.resourceKind')}
            </Label>
            <select
              id="resource-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as IncidentResourceKind)}
              className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {(['personnel', 'vehicle', 'equipment', 'aviation'] as const).map((item) => (
                <option key={item} value={item}>
                  {t(`resources.${item}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resource-name" required>
              {t('card.resourceName')}
            </Label>
            <Input
              id="resource-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="resource-qty" required>
                {t('card.resourceQty')}
              </Label>
              <Input
                id="resource-qty"
                type="number"
                min="1"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resource-org">{t('card.resourceOrg')}</Label>
              <Input
                id="resource-org"
                value={orgText}
                onChange={(event) => setOrgText(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || Number(qty) < 1}>
              {t('card.addResource')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
