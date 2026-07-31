import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Skeleton,
  cn,
  toast,
} from '@cuks/ui';
import { FileStack } from 'lucide-react';
import { documentContentText } from '@cuks/shared';
import { useDocumentTemplates, useInstantiateTemplate } from '../api/queries';

const fieldClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * Create a draft from a published template version (docs/modules/11 §12.7). Only active
 * templates that actually have a published version are offered — a draft body is still
 * being written, and the server refuses to instantiate one, so listing it would be an
 * invitation to an error.
 */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (documentId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const templates = useDocumentTemplates(open);
  const instantiate = useInstantiateTemplate();
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [startRoute, setStartRoute] = useState(false);

  const usable = useMemo(
    () => (templates.data ?? []).filter((tpl) => tpl.isActive && tpl.publishedVersion !== null),
    [templates.data],
  );
  const chosen = usable.find((tpl) => tpl.id === templateId) ?? usable[0];
  const preview = chosen?.versions.find((v) => v.version === chosen.publishedVersion) ?? null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosen || !subject.trim() || instantiate.isPending) return;
    instantiate.mutate(
      { templateId: chosen.id, input: { subject: subject.trim(), startRoute } },
      {
        onSuccess: ({ documentId }) => {
          toast({ title: t('templates.created'), tone: 'success' });
          onOpenChange(false);
          setSubject('');
          onCreated(documentId);
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('templates.pick.title')}</DialogTitle>
        </DialogHeader>
        {templates.isPending ? (
          <Skeleton className="h-32 w-full rounded-md" />
        ) : usable.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title={t('templates.pick.empty.title')}
            description={t('templates.pick.empty.description')}
          />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="template-pick">{t('templates.pick.template')}</Label>
              <select
                id="template-pick"
                className={fieldClass}
                value={chosen?.id ?? ''}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {usable.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} · v{tpl.publishedVersion}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="template-subject">{t('register.wizard.subject')}</Label>
              <Input
                id="template-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>

            {chosen?.routeTemplateId ? (
              // Offered only when the template actually names a route: a checkbox that does
              // nothing is worse than no checkbox.
              <label className="flex items-center gap-2 text-[13px] text-text">
                <input
                  type="checkbox"
                  checked={startRoute}
                  onChange={(e) => setStartRoute(e.target.checked)}
                />
                {t('templates.pick.startRoute')}
              </label>
            ) : null}

            {preview?.content ? (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-text">
                  {t('templates.pick.preview')}
                </span>
                {/* Plain text on purpose: the body is never rendered as markup here. */}
                <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                  {documentContentText(preview.content)}
                </p>
                {preview.variables.unknown.length > 0 ? (
                  <p className="text-xs text-warning">
                    {t('templates.pick.unknownVariables', {
                      list: preview.variables.unknown.join(', '),
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={instantiate.isPending || !subject.trim()}>
                {t('templates.pick.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
