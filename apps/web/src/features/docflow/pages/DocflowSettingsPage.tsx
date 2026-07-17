import { cloneElement, useId, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@cuks/ui';
import type {
  CorrespondentDto,
  CreateCorrespondentInput,
  CreateJournalInput,
  CreateNomenclatureInput,
  DocClass,
  JournalDto,
  JournalSeqReset,
  NomenclatureDto,
} from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  useCorrespondentCategories,
  useCorrespondents,
  useCreateCorrespondent,
  useCreateJournal,
  useCreateNomenclature,
  useDeleteCorrespondent,
  useDeleteJournal,
  useDeleteNomenclature,
  useJournals,
  useNomenclature,
  useUpdateCorrespondent,
  useUpdateJournal,
  useUpdateNomenclature,
} from '../api/queries';

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);
const DOC_CLASS_VALUES: readonly DocClass[] = ['incoming', 'outgoing', 'internal', 'citizens'];
const SEQ_RESET_VALUES: readonly JournalSeqReset[] = ['yearly', 'never'];
type Tab = 'journals' | 'correspondents' | 'nomenclature';
const TABS: readonly Tab[] = ['journals', 'correspondents', 'nomenclature'];

/** Map a known error code to a message; fall back to the generic failure toast. */
function useActionError() {
  const { t } = useTranslation('docflow');
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    const known =
      code && ['docflow.journal.code_taken', 'docflow.nomenclature.index_taken'].includes(code)
        ? t(`errors.${code.split('.').slice(-1)[0]}`)
        : t('common.actionFailed');
    toast({ title: known, tone: 'danger' });
  };
}

export function DocflowSettingsPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('settings.title'));
  const [tab, setTab] = useState<Tab>('journals');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <div
        role="tablist"
        aria-label={t('settings.title')}
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`settings.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === 'journals' && <JournalsPanel />}
      {tab === 'correspondents' && <CorrespondentsPanel />}
      {tab === 'nomenclature' && <NomenclaturePanel />}
    </div>
  );
}

// --- Journals ---------------------------------------------------------------

function JournalsPanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const journals = useJournals();
  const create = useCreateJournal();
  const update = useUpdateJournal();
  const remove = useDeleteJournal();
  const onError = useActionError();
  const [editing, setEditing] = useState<JournalDto | 'new' | null>(null);
  const [toRemove, setToRemove] = useState<JournalDto | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('journals.add')}
        </Button>
      </div>
      {journals.isPending ? (
        <Skeleton className="h-48 w-full rounded-md" />
      ) : journals.isError ? (
        <EmptyState
          title={t('common.loadError')}
          description={t('common.loadErrorHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void journals.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : journals.data.length === 0 ? (
        <EmptyState
          title={t('journals.empty.title')}
          description={t('journals.empty.description')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('journals.columns.name')}</TableHead>
              <TableHead className="w-28">{t('journals.columns.code')}</TableHead>
              <TableHead className="w-32">{t('journals.columns.class')}</TableHead>
              <TableHead>{t('journals.columns.template')}</TableHead>
              <TableHead className="w-24">{t('journals.columns.status')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {journals.data.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="font-medium text-text">{j.name}</TableCell>
                <TableCell className="font-mono text-xs text-text-muted">{j.code}</TableCell>
                <TableCell>{t(`docClass.${j.docClass}`)}</TableCell>
                <TableCell className="font-mono text-xs text-text-muted">
                  {j.numberTemplate}
                </TableCell>
                <TableCell>
                  <ActiveBadge active={j.isActive} />
                </TableCell>
                <TableCell>
                  <RowActions onEdit={() => setEditing(j)} onRemove={() => setToRemove(j)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && (
        <JournalDialog
          value={editing === 'new' ? null : editing}
          saving={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            const onSuccess = () => {
              toast({ title: t('common.saved'), tone: 'success' });
              setEditing(null);
            };
            if (editing === 'new') create.mutate(input, { onSuccess, onError });
            else update.mutate({ id: editing.id, input }, { onSuccess, onError });
          }}
        />
      )}
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('journals.remove.title')}
        description={t('journals.remove.description', { name: toRemove?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={() => {
          if (!toRemove) return;
          remove.mutate(toRemove.id, {
            onSuccess: () => {
              toast({ title: t('common.deleted'), tone: 'success' });
              setToRemove(null);
            },
            onError,
          });
        }}
      />
    </section>
  );
}

function JournalDialog(props: {
  value: JournalDto | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateJournalInput) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const isNew = props.value === null;
  const [code, setCode] = useState(props.value?.code ?? '');
  const [name, setName] = useState(props.value?.name ?? '');
  const [docClass, setDocClass] = useState<DocClass>(props.value?.docClass ?? 'incoming');
  const [numberTemplate, setNumberTemplate] = useState(
    props.value?.numberTemplate ?? '{П}-{YYYY}/{seq4}',
  );
  const [seqReset, setSeqReset] = useState<JournalSeqReset>(props.value?.seqReset ?? 'yearly');
  const [isActive, setIsActive] = useState(props.value?.isActive ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit({
      code: code.trim(),
      name: name.trim(),
      docClass,
      numberTemplate: numberTemplate.trim(),
      seqReset,
      isActive,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isNew ? t('journals.form.createTitle') : t('journals.form.editTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t('journals.form.code')}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!isNew}
              required
            />
          </Field>
          <Field label={t('journals.form.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('journals.form.class')}>
            <select
              className={selectClass}
              value={docClass}
              onChange={(e) => setDocClass(e.target.value as DocClass)}
            >
              {DOC_CLASS_VALUES.map((c) => (
                <option key={c} value={c}>
                  {t(`docClass.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('journals.form.template')} hint={t('journals.form.templateHint')}>
            <Input
              value={numberTemplate}
              onChange={(e) => setNumberTemplate(e.target.value)}
              required
              className="font-mono"
            />
          </Field>
          <Field label={t('journals.form.seqReset')}>
            <select
              className={selectClass}
              value={seqReset}
              onChange={(e) => setSeqReset(e.target.value as JournalSeqReset)}
            >
              {SEQ_RESET_VALUES.map((s) => (
                <option key={s} value={s}>
                  {t(`seqReset.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t('common.activeField')}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={props.saving}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Correspondents ---------------------------------------------------------

function CorrespondentsPanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const correspondents = useCorrespondents(search);
  const create = useCreateCorrespondent();
  const update = useUpdateCorrespondent();
  const remove = useDeleteCorrespondent();
  const categories = useCorrespondentCategories();
  const onError = useActionError();
  const [editing, setEditing] = useState<CorrespondentDto | 'new' | null>(null);
  const [toRemove, setToRemove] = useState<CorrespondentDto | null>(null);
  const categoryName = useMemo(() => {
    const map = new Map((categories.data ?? []).map((c) => [c.code, c.nameRu]));
    return (code: string | null) => (code ? (map.get(code) ?? code) : '—');
  }, [categories.data]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('correspondents.searchPlaceholder')}
          className="max-w-xs"
          aria-label={t('correspondents.searchPlaceholder')}
        />
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('correspondents.add')}
        </Button>
      </div>
      {correspondents.isPending ? (
        <Skeleton className="h-48 w-full rounded-md" />
      ) : correspondents.isError ? (
        <EmptyState
          title={t('common.loadError')}
          description={t('common.loadErrorHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void correspondents.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : correspondents.data.length === 0 ? (
        <EmptyState
          title={t('correspondents.empty.title')}
          description={t('correspondents.empty.description')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('correspondents.columns.name')}</TableHead>
              <TableHead className="w-40">{t('correspondents.columns.category')}</TableHead>
              <TableHead>{t('correspondents.columns.contact')}</TableHead>
              <TableHead className="w-24">{t('journals.columns.status')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {correspondents.data.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-text">
                  {c.name}
                  {c.shortName ? (
                    <span className="ml-1 text-text-muted">({c.shortName})</span>
                  ) : null}
                </TableCell>
                <TableCell>{categoryName(c.categoryCode)}</TableCell>
                <TableCell className="text-text-muted">{c.email ?? c.phones ?? '—'}</TableCell>
                <TableCell>
                  <ActiveBadge active={c.isActive} />
                </TableCell>
                <TableCell>
                  <RowActions onEdit={() => setEditing(c)} onRemove={() => setToRemove(c)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && (
        <CorrespondentDialog
          value={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          saving={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            const onSuccess = () => {
              toast({ title: t('common.saved'), tone: 'success' });
              setEditing(null);
            };
            if (editing === 'new') create.mutate(input, { onSuccess, onError });
            else update.mutate({ id: editing.id, input }, { onSuccess, onError });
          }}
        />
      )}
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('correspondents.remove.title')}
        description={t('correspondents.remove.description', { name: toRemove?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={() => {
          if (!toRemove) return;
          remove.mutate(toRemove.id, {
            onSuccess: () => {
              toast({ title: t('common.deleted'), tone: 'success' });
              setToRemove(null);
            },
            onError,
          });
        }}
      />
    </section>
  );
}

function CorrespondentDialog(props: {
  value: CorrespondentDto | null;
  categories: { code: string; nameRu: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateCorrespondentInput) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const isNew = props.value === null;
  const [name, setName] = useState(props.value?.name ?? '');
  const [shortName, setShortName] = useState(props.value?.shortName ?? '');
  const [categoryCode, setCategoryCode] = useState(props.value?.categoryCode ?? '');
  const [address, setAddress] = useState(props.value?.address ?? '');
  const [phones, setPhones] = useState(props.value?.phones ?? '');
  const [email, setEmail] = useState(props.value?.email ?? '');
  const [isActive, setIsActive] = useState(props.value?.isActive ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit({
      name: name.trim(),
      shortName: shortName.trim() || null,
      categoryCode: categoryCode || null,
      address: address.trim() || null,
      phones: phones.trim() || null,
      email: email.trim() || null,
      isActive,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isNew ? t('correspondents.form.createTitle') : t('correspondents.form.editTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t('correspondents.form.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('correspondents.form.shortName')}>
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} />
          </Field>
          <Field label={t('correspondents.form.category')}>
            <select
              className={selectClass}
              value={categoryCode}
              onChange={(e) => setCategoryCode(e.target.value)}
            >
              <option value="">{t('correspondents.form.noCategory')}</option>
              {props.categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameRu}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('correspondents.form.address')}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label={t('correspondents.form.phones')}>
            <Input value={phones} onChange={(e) => setPhones(e.target.value)} />
          </Field>
          <Field label={t('correspondents.form.email')}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t('common.activeField')}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={props.saving}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Nomenclature -----------------------------------------------------------

function NomenclaturePanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const items = useNomenclature();
  const create = useCreateNomenclature();
  const update = useUpdateNomenclature();
  const remove = useDeleteNomenclature();
  const onError = useActionError();
  const [editing, setEditing] = useState<NomenclatureDto | 'new' | null>(null);
  const [toRemove, setToRemove] = useState<NomenclatureDto | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('nomenclature.add')}
        </Button>
      </div>
      {items.isPending ? (
        <Skeleton className="h-48 w-full rounded-md" />
      ) : items.isError ? (
        <EmptyState
          title={t('common.loadError')}
          description={t('common.loadErrorHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void items.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : items.data.length === 0 ? (
        <EmptyState
          title={t('nomenclature.empty.title')}
          description={t('nomenclature.empty.description')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-28">{t('nomenclature.columns.index')}</TableHead>
              <TableHead>{t('nomenclature.columns.title')}</TableHead>
              <TableHead className="w-24">{t('journals.columns.status')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.data.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-xs text-text-muted">{n.index}</TableCell>
                <TableCell className="text-text">{n.title}</TableCell>
                <TableCell>
                  <ActiveBadge active={n.isActive} />
                </TableCell>
                <TableCell>
                  <RowActions onEdit={() => setEditing(n)} onRemove={() => setToRemove(n)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && (
        <NomenclatureDialog
          value={editing === 'new' ? null : editing}
          saving={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            const onSuccess = () => {
              toast({ title: t('common.saved'), tone: 'success' });
              setEditing(null);
            };
            if (editing === 'new') create.mutate(input, { onSuccess, onError });
            else update.mutate({ id: editing.id, input }, { onSuccess, onError });
          }}
        />
      )}
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('nomenclature.remove.title')}
        description={t('nomenclature.remove.description', { index: toRemove?.index ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={() => {
          if (!toRemove) return;
          remove.mutate(toRemove.id, {
            onSuccess: () => {
              toast({ title: t('common.deleted'), tone: 'success' });
              setToRemove(null);
            },
            onError,
          });
        }}
      />
    </section>
  );
}

function NomenclatureDialog(props: {
  value: NomenclatureDto | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateNomenclatureInput) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const isNew = props.value === null;
  const [index, setIndex] = useState(props.value?.index ?? '');
  const [title, setTitle] = useState(props.value?.title ?? '');
  const [retentionNote, setRetentionNote] = useState(props.value?.retentionNote ?? '');
  const [isActive, setIsActive] = useState(props.value?.isActive ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit({
      index: index.trim(),
      title: title.trim(),
      retentionNote: retentionNote.trim() || null,
      isActive,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isNew ? t('nomenclature.form.createTitle') : t('nomenclature.form.editTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t('nomenclature.form.index')}>
            <Input
              value={index}
              onChange={(e) => setIndex(e.target.value)}
              disabled={!isNew}
              required
              className="font-mono"
            />
          </Field>
          <Field label={t('nomenclature.form.title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label={t('nomenclature.form.retention')}>
            <Input value={retentionNote} onChange={(e) => setRetentionNote(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t('common.activeField')}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={props.saving}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Shared bits ------------------------------------------------------------

function Field(props: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string }>;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{props.label}</Label>
      {cloneElement(props.children, { id })}
      {props.hint ? <p className="text-xs text-text-muted">{props.hint}</p> : null}
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  return (
    <StatusBadge
      tone={active ? 'success' : 'neutral'}
      label={t(active ? 'common.active' : 'common.inactive')}
    />
  );
}

function RowActions(props: { onEdit: () => void; onRemove: () => void }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" aria-label={t('common.edit')} onClick={props.onEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('common.delete')} onClick={props.onRemove}>
        <Trash2 className="size-4 text-danger" />
      </Button>
    </div>
  );
}
