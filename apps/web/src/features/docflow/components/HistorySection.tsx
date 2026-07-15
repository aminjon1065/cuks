import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { EmptyState, Skeleton } from '@cuks/ui';
import type { DocumentDetailDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useDocumentHistory } from '../api/queries';

/** The «История» tab (docs/modules/11 §7): the document's audit events, newest first. */
export function HistorySection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentHistory(doc.id);
  const entries = query.data ?? [];

  if (query.isPending) return <Skeleton className="h-40 w-full rounded-md" />;
  if (query.isError) {
    return <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />;
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t('history.empty.title')}
        description={t('history.empty.description')}
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3">
          <div className="mt-1 size-2 shrink-0 rounded-full bg-primary/60" />
          <div className="min-w-0">
            <p className="text-[13px] text-text">{actionLabel(t, e.action)}</p>
            <p className="text-xs text-text-muted">
              {e.actorName ?? t('history.system')} · {formatDateTime(e.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Map a dotted audit action code to a flat i18n suffix (i18next treats dots as key
 *  separators, so the raw code can't be a key). Unknown codes show verbatim. */
const ACTION_SUFFIX: Record<string, string> = {
  'docflow.document.created': 'created',
  'docflow.document.file_added': 'file_added',
  'docflow.document.route_started': 'route_started',
  'docflow.document.route_step_done': 'route_step_done',
  'docflow.document.route_rejected': 'route_rejected',
  'docflow.document.registered': 'registered',
  'docflow.document.status_changed': 'status_changed',
  'docflow.document.signed': 'signed',
  'signature.created': 'signed',
  'docflow.document.resolution_added': 'resolution_added',
  'docflow.document.resolution_reported': 'resolution_reported',
  'docflow.document.resolution_done': 'resolution_done',
  'docflow.document.resolution_extended': 'resolution_extended',
  'docflow.document.resolution_cancelled': 'resolution_cancelled',
  'docflow.document.acknowledged': 'acknowledged',
  'docflow.document.linked': 'linked',
  'docflow.document.unlinked': 'unlinked',
  'docflow.document.exported': 'exported',
};

function actionLabel(t: (key: string) => string, action: string): string {
  const suffix = ACTION_SUFFIX[action];
  return suffix ? t(`history.actions.${suffix}`) : action;
}
