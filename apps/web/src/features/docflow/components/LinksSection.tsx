import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Link2, Plus, X } from 'lucide-react';
import { Button, EmptyState, Input, Skeleton, StatusBadge, toast } from '@cuks/ui';
import type { DocumentDetailDto } from '@cuks/shared';
import { documentStatusTone } from '../lib/document';
import {
  useAddDocumentLink,
  useDocuments,
  useDocumentLinks,
  useRemoveDocumentLink,
} from '../api/queries';

/** The «Связи» tab (docs/modules/11 §3/§7): related documents (bidirectional). Links are
 *  added by searching the caller's documents; removal is inline. */
export function LinksSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentLinks(doc.id);
  const add = useAddDocumentLink(doc.id);
  const remove = useRemoveDocumentLink(doc.id);
  const [adding, setAdding] = useState(false);
  const links = query.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">{t('links.subtitle')}</p>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" /> {t('links.add')}
        </Button>
      </div>

      {adding ? (
        <LinkPicker
          documentId={doc.id}
          excludeIds={[doc.id, ...links.map((l) => l.documentId)]}
          onPick={(targetId) =>
            add.mutate(
              { targetId, kind: 'related' },
              {
                onSuccess: () => {
                  toast({ title: t('links.added'), tone: 'success' });
                  setAdding(false);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}

      {query.isPending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : query.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : links.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={t('links.empty.title')}
          description={t('links.empty.description')}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 rounded-sm border border-border/60 px-3 py-2 text-[13px]"
            >
              <span className="rounded bg-surface-2 px-1.5 text-[11px] text-text-muted">
                {t(`links.kind.${l.kind}`)}
              </span>
              <RouterLink
                to={`/app/docs/${l.documentId}`}
                className="min-w-0 truncate text-primary hover:underline"
              >
                <span className="font-mono text-xs">
                  {l.regNumber ?? t('documents.unregistered')}
                </span>{' '}
                {l.subject}
              </RouterLink>
              <StatusBadge
                tone={documentStatusTone[l.status]}
                label={t(`documentStatus.${l.status}`)}
              />
              <button
                type="button"
                className="ml-auto text-text-muted hover:text-danger"
                aria-label={t('links.remove')}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(l.id, {
                    onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
                  })
                }
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkPicker({
  excludeIds,
  onPick,
}: {
  documentId: string;
  excludeIds: string[];
  onPick: (targetId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const results = useDocuments({ queue: 'mine', search: search.trim(), page: 1, limit: 8 });
  const items = (results.data?.items ?? []).filter((d) => !excludeIds.includes(d.id));

  return (
    <div className="flex flex-col gap-1">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('links.searchPlaceholder')}
      />
      {search.trim() ? (
        <div className="max-h-44 overflow-y-auto rounded-sm border border-border">
          {items.length === 0 ? (
            <div className="py-2 text-center text-xs text-text-muted">{t('links.noMatches')}</div>
          ) : (
            items.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onPick(d.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
              >
                <span className="font-mono text-xs text-text-muted">
                  {d.regNumber ?? t('documents.unregistered')}
                </span>
                <span className="min-w-0 truncate">{d.subject}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
