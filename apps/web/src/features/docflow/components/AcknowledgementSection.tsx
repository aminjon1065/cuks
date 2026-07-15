import { useTranslation } from 'react-i18next';
import { BookOpenCheck, Check, Clock } from 'lucide-react';
import { Button, EmptyState, Skeleton, toast } from '@cuks/ui';
import type { DocumentDetailDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useAcknowledge, useDocumentAcquaintances } from '../api/queries';

/** The card «Ознакомление» block (docs/modules/11 §6): who must read the order and who
 *  has, plus an «Ознакомлен» action when the caller has a pending line. */
export function AcknowledgementSection({
  doc,
}: {
  doc: DocumentDetailDto;
}): React.JSX.Element | null {
  const { t } = useTranslation('docflow');
  const query = useDocumentAcquaintances(doc.id);
  const acknowledge = useAcknowledge(doc.id);
  const sheet = query.data;

  // The block only exists once an acknowledge step has generated a sheet.
  if (query.isPending) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <Skeleton className="h-16 w-full rounded-md" />
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      </section>
    );
  }
  if (!sheet || sheet.total === 0) return null;

  const confirm = () => {
    if (!sheet.stepId) return;
    acknowledge.mutate(sheet.stepId, {
      onSuccess: () => toast({ title: t('acquaintances.doneToast'), tone: 'success' }),
      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
    });
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <BookOpenCheck className="size-4" /> {t('acquaintances.title')}
          <span className="text-xs font-normal text-text-muted">
            {t('acquaintances.progress', { done: sheet.acknowledged, total: sheet.total })}
          </span>
        </h2>
        {sheet.canAcknowledge ? (
          <Button size="sm" disabled={acknowledge.isPending} onClick={confirm}>
            {t('acquaintances.action')}
          </Button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1.5">
        {sheet.rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-[13px]">
            {r.acknowledgedAt ? (
              <Check className="size-4 shrink-0 text-success" />
            ) : (
              <Clock className="size-4 shrink-0 text-text-muted" />
            )}
            <span className="text-text">{r.userName ?? '—'}</span>
            {r.position ? <span className="text-xs text-text-muted">· {r.position}</span> : null}
            <span className="ml-auto text-xs text-text-muted">
              {r.acknowledgedAt ? formatDateTime(r.acknowledgedAt) : t('acquaintances.pending')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
