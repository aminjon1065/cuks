import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

/** Centered card used by every unauthenticated screen (login, force-password, TOTP). */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <ShieldAlert className="size-6" />
          </div>
          <div className="text-sm font-semibold text-text">{t('appFullName')}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-[var(--shadow-1)]">
          <h1 className="text-lg font-semibold text-text">{title}</h1>
          {subtitle ? <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
