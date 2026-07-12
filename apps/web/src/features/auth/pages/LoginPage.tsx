import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Label } from '@cuks/ui';
import type { LoginInput } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { AuthCard } from '../components/AuthCard';
import { useLogin } from '../api/queries';

const ERROR_KEY: Record<string, string> = {
  'auth.login.invalid_credentials': 'login.errors.invalid',
  'auth.login.blocked': 'login.errors.blocked',
  'auth.login.locked': 'login.errors.locked',
  'auth.login.totp_required': 'login.errors.totpRequired',
  'auth.login.totp_invalid': 'login.errors.totpInvalid',
};

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [remember, setRemember] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setErrorCode(null);
    const input: LoginInput = { username, password, remember };
    if (showTotp && totp) input.totp = totp;
    login.mutate(input, {
      onSuccess: () => navigate(from, { replace: true }),
      onError: (error) => {
        const code = error instanceof ApiError ? error.code : 'auth.login.generic';
        if (code === 'auth.login.totp_required') setShowTotp(true);
        setErrorCode(code);
      },
    });
  };

  const errorText = errorCode ? t(ERROR_KEY[errorCode] ?? 'login.errors.generic') : null;
  const errorIsHint = errorCode === 'auth.login.totp_required';

  return (
    <AuthCard title={t('login.title')} subtitle={t('login.subtitle')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="username" required>
            {t('login.username')}
          </Label>
          <Input
            id="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" required>
            {t('login.password')}
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {showTotp ? (
          <div className="space-y-1.5">
            <Label htmlFor="totp">{t('login.totp')}</Label>
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
            <p className="text-xs text-text-muted">{t('login.totpHint')}</p>
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-[13px] text-text">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('login.remember')}
        </label>

        {errorText ? (
          <p
            role={errorIsHint ? 'status' : 'alert'}
            className={errorIsHint ? 'text-[13px] text-text-muted' : 'text-[13px] text-danger'}
          >
            {errorText}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {t('login.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
