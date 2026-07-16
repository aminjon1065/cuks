import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { FileText, Link2, ShieldAlert, X } from 'lucide-react';
import { Skeleton, cn, toast } from '@cuks/ui';
import { useCardLinks, useRemoveCardLink } from '../api/queries';

/** The card's «Связи» — links to ЧС / documents (docs/modules/15 §4, task 4.5). Adding happens from
 *  the ЧС / document side; here they are shown and (for editors) removed. */
export function TaskLinksSection({
  cardId,
  canEdit,
}: {
  cardId: string;
  canEdit: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const query = useCardLinks(cardId);
  const remove = useRemoveCardLink(cardId);

  if (query.isPending) return <Skeleton className="h-16 rounded-md" />;
  if ((query.data ?? []).length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-6 text-center text-[13px] text-text-muted">
        <Link2 className="size-5" />
        {t('links.empty')}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {query.data!.map((link) => {
        const Icon = link.targetType === 'incident' ? ShieldAlert : FileText;
        return (
          <li key={link.id} className="group flex items-center gap-2">
            <RouterLink
              to={link.route}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 hover:border-primary/40"
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  link.targetType === 'incident' ? 'text-danger' : 'text-primary',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-text">{link.title}</span>
              <span className="shrink-0 text-xs text-text-muted">
                {t(`links.type.${link.targetType}`)}
              </span>
            </RouterLink>
            {canEdit ? (
              <button
                type="button"
                title={t('links.remove')}
                onClick={() =>
                  remove.mutate(link.id, {
                    onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
                  })
                }
                className="opacity-0 transition group-hover:opacity-100 hover:text-danger"
              >
                <X className="size-4 text-text-muted" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
