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
import type { TempPasswordDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useCreateUser } from '../api/queries';
import { TempPasswordView } from './TempPasswordView';

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('admin');
  const create = useCreateUser();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<TempPasswordDto | null>(null);

  const reset = (): void => {
    setFullName('');
    setEmail('');
    setPhone('');
    setResult(null);
  };
  // Single close path so every dismissal (footer button, ✕, Esc, overlay) clears the
  // form — otherwise reopening would still show the previous user's temp password.
  const handleOpenChange = (o: boolean): void => {
    onOpenChange(o);
    if (!o) reset();
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    create.mutate(
      { fullName, ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
      {
        onSuccess: (data) => setResult(data),
        onError: (err) =>
          toast({
            title: err instanceof ApiError ? err.message : t('common.actionFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {result ? t('users.tempPassword.title') : t('users.create_form.title')}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <>
            <TempPasswordView data={result} />
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{t('common.close')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName" required>
                {t('users.create_form.fullName')}
              </Label>
              <Input
                id="fullName"
                autoFocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('users.create_form.fullNamePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('users.create_form.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t('users.create_form.phone')}</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-text-muted">{t('users.create_form.hint')}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || fullName.trim().length < 3}>
                {t('users.create_form.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
