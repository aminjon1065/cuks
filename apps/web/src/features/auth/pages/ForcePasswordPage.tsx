import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Label } from '@cuks/ui';
import { PASSWORD_MIN_LENGTH } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/lib/use-document-title';
import { AuthCard } from '../components/AuthCard';
import { useChangePassword } from '../api/queries';

export function ForcePasswordPage(): React.JSX.Element {
  const { t } = useTranslation('auth');
  useDocumentTitle(t('forcePassword.title'));
  const navigate = useNavigate();
  const changePassword = useChangePassword();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setErrorText(null);
    if (next.length < PASSWORD_MIN_LENGTH) {
      setErrorText(t('forcePassword.errors.tooShort'));
      return;
    }
    if (next !== confirm) {
      setErrorText(t('forcePassword.errors.mismatch'));
      return;
    }
    changePassword.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => navigate('/', { replace: true }),
        onError: (error) => {
          const message = error instanceof ApiError ? error.message : null;
          setErrorText(message ?? t('forcePassword.errors.generic'));
        },
      },
    );
  };

  return (
    <AuthCard title={t('forcePassword.title')} subtitle={t('forcePassword.subtitle')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="current" required>
            {t('forcePassword.current')}
          </Label>
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="next" required>
            {t('forcePassword.new')}
          </Label>
          <Input
            id="next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm" required>
            {t('forcePassword.confirm')}
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {errorText ? (
          <p role="alert" className="text-[13px] text-danger">
            {errorText}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={changePassword.isPending}>
          {t('forcePassword.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
