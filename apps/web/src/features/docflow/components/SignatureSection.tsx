import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BadgeCheck, PenLine, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, Skeleton, StatusBadge } from '@cuks/ui';
import type { DocumentDetailDto } from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { formatDateTime } from '@/lib/format';
import { useDocumentRoutes, useDocumentSignatures } from '../api/queries';
import { SignDialog } from './SignDialog';

/** The card «Подписи» block (docs/modules/11 §6): existing signatures with a live
 *  validity check, and a Sign action when the caller has an active signing step. */
export function SignatureSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentSignatures(doc.id);
  const routes = useDocumentRoutes(doc.id);
  const [signOpen, setSignOpen] = useState(false);

  const hasSignStep = (routes.data ?? []).some(
    (r) =>
      r.status === 'active' &&
      r.steps.some((s) => s.kind === 'sign' && s.status === 'active' && s.canAct),
  );
  const canSign = useCan('docflow.sign') && hasSignStep;
  const signatures = query.data ?? [];

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <BadgeCheck className="size-4" /> {t('signatures.title')}
        </h2>
        {canSign ? (
          <Button size="sm" onClick={() => setSignOpen(true)}>
            <PenLine className="size-4" /> {t('signatures.sign.action')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : query.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : signatures.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('signatures.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {signatures.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border/60 p-3"
            >
              {s.valid ? (
                <ShieldCheck className="size-4 shrink-0 text-success" />
              ) : (
                <ShieldAlert className="size-4 shrink-0 text-danger" />
              )}
              <span className="text-[13px] font-medium text-text">{s.userName ?? '—'}</span>
              <StatusBadge
                tone={s.valid ? 'success' : 'danger'}
                label={s.valid ? t('signatures.valid') : t('signatures.invalid')}
              />
              <span className="text-xs text-text-muted">{formatDateTime(s.signedAt)}</span>
              <Link to={`/verify/${s.id}`} className="ml-auto text-xs text-primary hover:underline">
                {t('signatures.verifyLink')}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {signOpen ? <SignDialog doc={doc} onClose={() => setSignOpen(false)} /> : null}
    </section>
  );
}
