import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, Check, Pencil, Share2, Trash2, Users } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  cn,
  toast,
} from '@cuks/ui';
import { DOCUMENT_VIEW_PARAMS, type DocumentViewDto } from '@cuks/shared';
import {
  useDeleteDocumentView,
  useDocumentViews,
  useSaveDocumentView,
  useUpdateDocumentView,
} from '../api/queries';

/**
 * Saved register views (plan этап 9) — the register's filters, named and kept.
 *
 * A view is a set of FILTERS, so applying one is just writing the URL: everything downstream
 * — the list query, its visibility, its counts — is the register's own, and a shared view
 * shows each colleague their own documents rather than the author's.
 *
 * A colleague's shared view is offered but not editable. It is a convenience, not a handover:
 * whoever built it keeps it, and the server enforces that regardless of what this renders.
 */
export function SavedViewsBar({
  current,
  onApply,
}: {
  /** The filters as they are right now — what «Сохранить вид» would store. */
  current: Record<string, string>;
  onApply: (params: Record<string, string>) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const { data: views } = useDocumentViews();
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<DocumentViewDto | null>(null);
  const [removing, setRemoving] = useState<DocumentViewDto | null>(null);
  const update = useUpdateDocumentView();
  const remove = useDeleteDocumentView();

  const list = views ?? [];
  // Which view the register currently shows, if any — compared on the filters themselves, so
  // arriving by a pasted link highlights the right chip.
  const activeId = list.find((v) => sameParams(v.params, current))?.id ?? null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((view) => {
        const active = view.id === activeId;
        return (
          <span
            key={view.id}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[13px]',
              active
                ? 'border-primary bg-primary/10 text-text'
                : 'border-border bg-surface text-text-muted hover:text-text',
            )}
          >
            <button
              type="button"
              onClick={() => onApply(view.params)}
              className="inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:underline"
            >
              {active ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
              {view.name}
              {view.ownerName ? (
                // Somebody else's: say whose, or a shared preset reads as one of your own that
                // you cannot delete.
                <span className="inline-flex items-center gap-0.5 text-xs text-text-muted">
                  <Users className="size-3" aria-hidden />
                  {view.ownerName}
                </span>
              ) : null}
            </button>
            {view.canManage ? (
              <span className="flex items-center">
                <button
                  type="button"
                  onClick={() => setRenaming(view)}
                  aria-label={t('savedViews.rename', { name: view.name })}
                  className="rounded-full p-1 text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setRemoving(view)}
                  aria-label={t('savedViews.delete', { name: view.name })}
                  className="rounded-full p-1 text-text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ) : null}
          </span>
        );
      })}

      <Button size="sm" variant="ghost" onClick={() => setSaving(true)}>
        <BookmarkPlus className="size-3.5" aria-hidden /> {t('savedViews.save')}
      </Button>

      {saving ? <SaveViewDialog params={current} onClose={() => setSaving(false)} /> : null}
      {renaming ? (
        <RenameViewDialog
          view={renaming}
          onClose={() => setRenaming(null)}
          onSubmit={(input) =>
            update.mutate(
              { id: renaming.id, input },
              {
                onSuccess: () => {
                  toast({ title: t('common.saved'), tone: 'success' });
                  setRenaming(null);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t('savedViews.deleteTitle')}
          description={t('savedViews.deleteConfirm', { name: removing.name })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          entityName={removing.name}
          onConfirm={() =>
            remove.mutate(removing.id, {
              onSuccess: () => {
                toast({ title: t('common.deleted'), tone: 'success' });
                setRemoving(null);
              },
              onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
            })
          }
        />
      ) : null}
    </div>
  );
}

function SaveViewDialog({
  params,
  onClose,
}: {
  params: Record<string, string>;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const save = useSaveDocumentView();
  const [name, setName] = useState('');
  const [isShared, setShared] = useState(false);
  const count = Object.keys(params).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('savedViews.saveTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!name.trim()) return;
            save.mutate(
              { name: name.trim(), params, isShared },
              {
                onSuccess: () => {
                  toast({ title: t('common.saved'), tone: 'success' });
                  onClose();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="view-name">{t('savedViews.nameLabel')}</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('savedViews.namePlaceholder')}
              required
              autoFocus
            />
            <p className="text-xs text-text-muted">{t('savedViews.willStore', { count })}</p>
          </div>
          <ShareToggle checked={isShared} onChange={setShared} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameViewDialog({
  view,
  onClose,
  onSubmit,
}: {
  view: DocumentViewDto;
  onClose: () => void;
  onSubmit: (input: { name: string; isShared: boolean }) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [name, setName] = useState(view.name);
  const [isShared, setShared] = useState(view.isShared);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('savedViews.renameTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!name.trim()) return;
            onSubmit({ name: name.trim(), isShared });
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="view-rename">{t('savedViews.nameLabel')}</Label>
            <Input
              id="view-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <ShareToggle checked={isShared} onChange={setShared} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  return (
    <label className="flex items-start gap-2 text-[13px] text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--color-primary)]"
      />
      <span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Share2 className="size-3.5" aria-hidden /> {t('savedViews.shareLabel')}
        </span>
        {/* Said plainly, because «поделиться» over a register invites the wrong worry: a view
            carries filters, and each colleague still sees only their own documents. */}
        <span className="mt-0.5 block text-xs text-text-muted">{t('savedViews.shareHint')}</span>
      </span>
    </label>
  );
}

/** Two filter sets are the same view when they hold the same keys with the same values. */
function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = DOCUMENT_VIEW_PARAMS.filter((k) => a[k] !== undefined || b[k] !== undefined);
  return keys.every((k) => (a[k] ?? '') === (b[k] ?? ''));
}
