import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { TempPasswordDto } from '@cuks/shared';

function CopyRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const { t } = useTranslation('admin');
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code
          data-testid={testId}
          className="flex-1 select-all rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] text-text"
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex size-8 items-center justify-center rounded-md border border-border text-text-muted hover:text-text"
          aria-label={t('common.copy')}
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/** One-time credential reveal shown after create / password reset. */
export function TempPasswordView({ data }: { data: TempPasswordDto }): React.JSX.Element {
  const { t } = useTranslation('admin');
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-text-muted">{t('users.tempPassword.description')}</p>
      <CopyRow
        label={t('users.tempPassword.username')}
        value={data.username}
        testId="temp-username"
      />
      <CopyRow
        label={t('users.tempPassword.password')}
        value={data.tempPassword}
        testId="temp-password"
      />
    </div>
  );
}
