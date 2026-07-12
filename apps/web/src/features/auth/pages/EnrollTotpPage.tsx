import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Label, Skeleton } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { AuthCard } from '../components/AuthCard';
import { useTotpConfirm, useTotpSetup } from '../api/queries';

export function EnrollTotpPage(): React.JSX.Element {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setup = useTotpSetup();
  const confirm = useTotpConfirm();
  const [code, setCode] = useState('');

  const secret = setup.data?.secret ?? null;
  const backupCodes = confirm.data?.backupCodes ?? null;

  const errorText = confirm.isError
    ? confirm.error instanceof ApiError && confirm.error.status === 422
      ? t('totp.errors.invalid')
      : t('totp.errors.generic')
    : setup.isError
      ? t('totp.errors.generic')
      : null;

  const onConfirm = (event: FormEvent): void => {
    event.preventDefault();
    confirm.mutate(code);
  };

  if (backupCodes) {
    return (
      <AuthCard title={t('totp.backupTitle')}>
        <p className="text-[13px] text-text-muted">{t('totp.backupHint')}</p>
        <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-[13px]">
          {backupCodes.map((c) => (
            <li
              key={c}
              className="rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-center"
            >
              {c}
            </li>
          ))}
        </ul>
        <Button className="mt-5 w-full" onClick={() => navigate('/', { replace: true })}>
          {t('totp.done')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('totp.title')} subtitle={t('totp.subtitle')}>
      <p className="text-[13px] text-text-muted">{t('totp.scanHint')}</p>
      <div className="mt-3">
        <Label>{t('totp.secretLabel')}</Label>
        {secret ? (
          <code className="mt-1 block select-all break-all rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] text-text">
            {secret}
          </code>
        ) : (
          <Skeleton className="mt-1 h-10 w-full" />
        )}
      </div>

      <form onSubmit={onConfirm} className="mt-5 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="code" required>
            {t('totp.code')}
          </Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        {errorText ? (
          <p role="alert" className="text-[13px] text-danger">
            {errorText}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={!secret || confirm.isPending}>
          {t('totp.confirm')}
        </Button>
      </form>
    </AuthCard>
  );
}
