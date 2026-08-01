import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileStack, Plus } from 'lucide-react';
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
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import {
  type DocClass,
  type DocumentContent,
  type DocumentTemplateDto,
  type DocumentTemplateVersionDto,
} from '@cuks/shared';
import {
  useAddTemplateVersion,
  useCreateDocumentTemplate,
  useDeactivateDocumentTemplate,
  useDocumentTemplates,
  usePublishTemplateVersion,
} from '../api/queries';
import { DocumentContentEditor } from './DocumentContentEditor';

const fieldClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);
const DOC_CLASS_VALUES: readonly DocClass[] = ['incoming', 'outgoing', 'internal', 'citizens'];

/**
 * Document templates admin (docs/modules/11 §12.7). A template's body is never edited in
 * place — a published version is frozen, because documents record which version produced
 * them. Editing here means composing the NEXT draft version and publishing that, which is
 * why the panel shows the version history rather than a single body.
 */
export function TemplatesPanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const templates = useDocumentTemplates();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = templates.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> {t('templates.admin.add')}
        </Button>
      </div>

      {templates.isPending ? (
        <Skeleton className="h-40 w-full rounded-md" />
      ) : templates.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title={t('templates.admin.empty.title')}
          description={t('templates.admin.empty.description')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((tpl) => (
            <TemplateRow
              key={tpl.id}
              template={tpl}
              open={openId === tpl.id}
              onToggle={() => setOpenId(openId === tpl.id ? null : tpl.id)}
            />
          ))}
        </ul>
      )}

      {creating ? <CreateTemplateDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function TemplateRow({
  template,
  open,
  onToggle,
}: {
  template: DocumentTemplateDto;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const deactivate = useDeactivateDocumentTemplate();
  const [composing, setComposing] = useState(false);

  return (
    <li className="rounded-sm border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[13px] font-medium text-text">{template.name}</span>
          <span className="block text-xs text-text-muted">
            {template.code} · {t(`docClass.${template.docClass}`)}
          </span>
        </button>
        <StatusBadge
          tone={template.publishedVersion ? 'success' : 'neutral'}
          label={
            template.publishedVersion
              ? t('templates.admin.published', { version: template.publishedVersion })
              : t('templates.admin.noPublished')
          }
        />
        {!template.isActive ? (
          <StatusBadge tone="neutral" label={t('templates.admin.retired')} />
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
          {t('templates.admin.newVersion')}
        </Button>
        {template.isActive ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={deactivate.isPending}
            onClick={() =>
              deactivate.mutate(template.id, {
                onSuccess: () =>
                  toast({ title: t('templates.admin.retiredDone'), tone: 'success' }),
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              })
            }
          >
            {t('templates.admin.retire')}
          </Button>
        ) : null}
      </div>

      {open ? <VersionList template={template} /> : null}
      {composing ? (
        <ComposeVersionDialog template={template} onClose={() => setComposing(false)} />
      ) : null}
    </li>
  );
}

function VersionList({ template }: { template: DocumentTemplateDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const publish = usePublishTemplateVersion();

  if (template.versions.length === 0) {
    return (
      <p className="border-t border-border px-3 py-2 text-[13px] text-text-muted">
        {t('templates.admin.noVersions')}
      </p>
    );
  }
  return (
    <ul className="flex flex-col border-t border-border">
      {template.versions.map((v) => (
        <li
          key={v.id}
          className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0"
        >
          <span className="text-[13px] text-text">v{v.version}</span>
          <StatusBadge
            tone={v.isPublished ? 'success' : 'warning'}
            label={
              v.isPublished
                ? t('templates.admin.state.published')
                : t('templates.admin.state.draft')
            }
          />
          {v.variables.unknown.length > 0 ? (
            <span className="text-xs text-warning">
              {t('templates.pick.unknownVariables', { list: v.variables.unknown.join(', ') })}
            </span>
          ) : null}
          <span className="min-w-0 flex-1" />
          {v.isPublished ? (
            <span className="text-xs text-text-muted">{v.publishedByName ?? ''}</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate(
                  { templateId: template.id, version: v.version },
                  {
                    onSuccess: () =>
                      toast({ title: t('templates.admin.publishedDone'), tone: 'success' }),
                    onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
                  },
                )
              }
            >
              <Check className="size-4" aria-hidden /> {t('templates.admin.publish')}
            </Button>
          )}
          <VersionPreview version={v} />
        </li>
      ))}
    </ul>
  );
}

function VersionPreview({ version }: { version: DocumentTemplateVersionDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t('templates.admin.view')}
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {t('templates.admin.versionTitle', { version: version.version })}
              </DialogTitle>
            </DialogHeader>
            {/* Read-only: a published body is frozen, and a draft is edited by composing
                the next version, never by rewriting this one. */}
            <DocumentContentEditor value={version.content} readOnly />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function ComposeVersionDialog({
  template,
  onClose,
}: {
  template: DocumentTemplateDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const addVersion = useAddTemplateVersion();
  // Seeded from the newest version so a correction starts from what is there today.
  const [content, setContent] = useState<DocumentContent>(
    template.versions[0]?.content ?? { type: 'doc', content: [] },
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('templates.admin.newVersionTitle', { name: template.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-text-muted">{t('templates.admin.variablesHint')}</p>
        <DocumentContentEditor
          value={content}
          onSave={async (next) => {
            setContent(next);
            return Promise.resolve();
          }}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={addVersion.isPending}
            onClick={() =>
              addVersion.mutate(
                { templateId: template.id, input: { content } },
                {
                  onSuccess: () => {
                    toast({ title: t('templates.admin.versionAdded'), tone: 'success' });
                    onClose();
                  },
                  onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
                },
              )
            }
          >
            {t('templates.admin.saveVersion')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateTemplateDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const create = useCreateDocumentTemplate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [docClass, setDocClass] = useState<DocClass>('internal');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || create.isPending) return;
    create.mutate(
      { code: code.trim(), name: name.trim(), docClass },
      {
        onSuccess: () => {
          toast({ title: t('templates.admin.created'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('templates.admin.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="tpl-code">{t('journals.form.code')}</Label>
            <Input id="tpl-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tpl-name">{t('journals.form.name')}</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tpl-class">{t('journals.form.class')}</Label>
            <select
              id="tpl-class"
              className={fieldClass}
              value={docClass}
              onChange={(e) => setDocClass(e.target.value as DocClass)}
            >
              {DOC_CLASS_VALUES.map((c) => (
                <option key={c} value={c}>
                  {t(`docClass.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('templates.admin.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
