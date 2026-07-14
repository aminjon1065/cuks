import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

/** A labelled, copy-to-clipboard value — connection parameters and generated
 *  credentials (task 2.9). */
export function CopyField({
  label,
  value,
  testId,
  mono = true,
}: {
  label: string;
  value: string;
  testId?: string;
  mono?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('gisAccess');
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code
          data-testid={testId}
          className={`min-w-0 flex-1 select-all truncate rounded-sm border border-border bg-surface-2 px-3 py-2 text-[13px] text-text ${
            mono ? 'font-mono' : ''
          }`}
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
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={t('copy')}
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}
