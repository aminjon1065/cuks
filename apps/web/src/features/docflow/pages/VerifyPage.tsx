import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Check, ShieldCheck, ShieldX, X } from 'lucide-react';
import { Button, EmptyState, PageHeader, Skeleton } from '@cuks/ui';
import type { VerifyCheckDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useVerifySignature } from '../api/queries';
import { useDocumentTitle } from '@/lib/use-document-title';

/** Signature verification page (docs/09-security.md §4, task 3.5): validity, chain to
 *  CA, revocation at signing time, and whether the file still matches. */
export function VerifyPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('signatures.verify.title'));
  const { signatureId } = useParams<{ signatureId: string }>();
  const query = useVerifySignature(signatureId ?? null);

  if (query.isPending) return <Skeleton className="h-80 w-full max-w-2xl rounded-md" />;
  if (query.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t('common.loadError')}
        description={t('common.loadErrorHint')}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }
  if (!query.data) {
    return (
      <EmptyState
        icon={ShieldX}
        title={t('signatures.verify.notFound')}
        description={t('signatures.verify.notFoundHint')}
      />
    );
  }
  const r = query.data;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title={t('signatures.verify.title')} description={r.documentSubject} />

      <div
        className={`flex items-center gap-3 rounded-md border p-4 ${
          r.valid
            ? 'border-success/30 bg-success/5 text-success'
            : 'border-danger/30 bg-danger/5 text-danger'
        }`}
      >
        {r.valid ? <ShieldCheck className="size-6" /> : <ShieldX className="size-6" />}
        <div>
          <p className="text-sm font-semibold">
            {r.valid ? t('signatures.verify.valid') : t('signatures.verify.invalid')}
          </p>
          <p className="text-xs opacity-80">
            {r.valid ? t('signatures.verify.validHint') : t('signatures.verify.invalidHint')}
          </p>
        </div>
      </div>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-text">{t('signatures.verify.checks')}</h2>
        <ul className="flex flex-col gap-2">
          {r.checks.map((c) => (
            <CheckRow key={c.key} check={c} label={t(`signatures.verify.check.${c.key}`)} />
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-text">{t('signatures.verify.details')}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Detail label={t('signatures.verify.signer')} value={r.signerName ?? '—'} />
          <Detail label={t('signatures.verify.position')} value={r.signerPosition ?? '—'} />
          <Detail label={t('signatures.verify.serial')} value={r.certificateSerial} mono />
          <Detail label={t('signatures.verify.signedAt')} value={formatDateTime(r.signedAt)} />
          <Detail label={t('signatures.verify.document')} value={r.documentSubject} />
          <Detail
            label={t('documents.columns.number')}
            value={r.documentRegNumber ?? t('documents.unregistered')}
          />
        </dl>
      </section>
    </div>
  );
}

function CheckRow({ check, label }: { check: VerifyCheckDto; label: string }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 text-[13px]">
      {check.ok ? <Check className="size-4 text-success" /> : <X className="size-4 text-danger" />}
      <span className={check.ok ? 'text-text' : 'text-danger'}>{label}</span>
    </li>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1">
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className={`text-right text-[13px] text-text ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
