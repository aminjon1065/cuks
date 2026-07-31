import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, GitBranch, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Skeleton, StatusBadge, toast } from '@cuks/ui';
import type { RouteTemplateDto } from '@cuks/shared';
import {
  useCloneRouteTemplate,
  useDeleteRouteTemplate,
  useRouteTemplates,
  useUpdateRouteTemplate,
} from '../api/queries';

/**
 * Route templates in the docflow settings (docs/modules/11 §12.9). A started route
 * snapshots its steps, so editing a template never disturbs a route in flight — which is
 * why a variant is made by cloning rather than by versioning. A clone lands retired, so an
 * unreviewed copy never appears in a picker beside the original.
 */
export function RouteTemplatesPanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const templates = useRouteTemplates();
  const clone = useCloneRouteTemplate();
  const update = useUpdateRouteTemplate();
  const remove = useDeleteRouteTemplate();
  const [toRemove, setToRemove] = useState<RouteTemplateDto | null>(null);
  const items = templates.data ?? [];

  const fail = () => toast({ title: t('common.actionFailed'), tone: 'danger' });

  return (
    <div className="flex flex-col gap-3">
      {templates.isPending ? (
        <Skeleton className="h-40 w-full rounded-md" />
      ) : templates.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title={t('routeTemplates.empty.title')}
          description={t('routeTemplates.empty.description')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((tpl) => (
            <li
              key={tpl.id}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text">{tpl.name}</span>
                <span className="block text-xs text-text-muted">
                  {t('routeTemplates.steps', { count: tpl.steps.length })}
                  {tpl.orgUnitName ? ` · ${tpl.orgUnitName}` : ''}
                </span>
              </span>
              <StatusBadge
                tone={tpl.isActive ? 'success' : 'neutral'}
                label={tpl.isActive ? t('routeTemplates.active') : t('routeTemplates.retired')}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={clone.isPending}
                onClick={() =>
                  clone.mutate(tpl.id, {
                    onSuccess: () => toast({ title: t('routeTemplates.cloned'), tone: 'success' }),
                    onError: fail,
                  })
                }
              >
                <Copy className="size-4" aria-hidden /> {t('routeTemplates.clone')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: tpl.id, input: { isActive: !tpl.isActive } },
                    { onError: fail },
                  )
                }
              >
                {tpl.isActive ? t('routeTemplates.retire') : t('routeTemplates.activate')}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t('routeTemplates.remove.action', { name: tpl.name })}
                onClick={() => setToRemove(tpl)}
              >
                <Trash2 className="size-4 text-danger" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {toRemove ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setToRemove(null)}
          title={t('routeTemplates.remove.title')}
          description={t('routeTemplates.remove.description', { name: toRemove.name })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          entityName={toRemove.name}
          destructive
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(toRemove.id, {
              onSuccess: () => setToRemove(null),
              onError: fail,
            })
          }
        />
      ) : null}
    </div>
  );
}
