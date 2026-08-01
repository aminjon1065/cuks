import { useState, type FormEvent } from 'react';
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
import {
  RESOLUTION_ACTION_KINDS,
  type CreateResolutionTypeInput,
  type ResolutionActionKind,
  type ResolutionTypeDto,
} from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import {
  useCreateResolutionType,
  useDeleteResolutionType,
  useResolutionTypes,
  useUpdateResolutionType,
} from '../api/queries';

const controlClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * The resolution-type dictionary (docs/modules/11 §12.11): the typical wordings the
 * chancellery picks from, and what each one insists on. A type that live proposals point
 * at cannot be deleted — the error says so and offers deactivation instead, which keeps the
 * history of those proposals readable.
 */
export function ResolutionTypesPanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const types = useResolutionTypes();
  const create = useCreateResolutionType();
  const update = useUpdateResolutionType();
  const remove = useDeleteResolutionType();
  const [editing, setEditing] = useState<ResolutionTypeDto | 'new' | null>(null);
  const [toRemove, setToRemove] = useState<ResolutionTypeDto | null>(null);

  const onError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    const known =
      code === 'docflow.resolution_type.in_use'
        ? t('resolutionTypes.errors.inUse')
        : code === 'docflow.resolution_type.code_taken'
          ? t('resolutionTypes.errors.codeTaken')
          : t('common.actionFailed');
    toast({ title: known, tone: 'danger' });
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('resolutionTypes.add')}
        </Button>
      </div>
      {types.isPending ? (
        <Skeleton className="h-48 w-full rounded-md" />
      ) : types.isError ? (
        <EmptyState
          title={t('common.loadError')}
          description={t('common.loadErrorHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void types.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : types.data.length === 0 ? (
        <EmptyState
          title={t('resolutionTypes.empty.title')}
          description={t('resolutionTypes.empty.description')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('resolutionTypes.columns.name')}</TableHead>
              <TableHead className="w-28">{t('journals.columns.code')}</TableHead>
              <TableHead className="w-36">{t('resolutionTypes.columns.kind')}</TableHead>
              <TableHead>{t('resolutionTypes.columns.requires')}</TableHead>
              <TableHead className="w-24">{t('journals.columns.status')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.data.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="font-medium text-text">{x.nameRu}</TableCell>
                <TableCell className="font-mono text-xs text-text-muted">{x.code}</TableCell>
                <TableCell>{t(`resolutionActionKind.${x.actionKind}`)}</TableCell>
                <TableCell className="text-xs text-text-muted">
                  {[
                    x.requiresExecutor ? t('resolutionTypes.flags.executor') : null,
                    x.requiresDueAt ? t('resolutionTypes.flags.due') : null,
                    x.requiresOutgoingResponse ? t('resolutionTypes.flags.response') : null,
                    x.defaultControl ? t('resolutions.control') : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={x.isActive ? 'success' : 'neutral'}
                    label={t(x.isActive ? 'common.active' : 'common.inactive')}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.edit')}
                      onClick={() => setEditing(x)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.delete')}
                      onClick={() => setToRemove(x)}
                    >
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing ? (
        <ResolutionTypeDialog
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
      ) : null}
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('resolutionTypes.remove.title')}
        description={t('resolutionTypes.remove.description', { name: toRemove?.nameRu ?? '' })}
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

function ResolutionTypeDialog(props: {
  value: ResolutionTypeDto | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateResolutionTypeInput) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const isNew = props.value === null;
  const [code, setCode] = useState(props.value?.code ?? '');
  const [nameRu, setNameRu] = useState(props.value?.nameRu ?? '');
  const [nameTj, setNameTj] = useState(props.value?.nameTj ?? '');
  const [actionKind, setActionKind] = useState<ResolutionActionKind>(
    props.value?.actionKind ?? 'execute',
  );
  const [requiresExecutor, setRequiresExecutor] = useState(props.value?.requiresExecutor ?? true);
  const [requiresDueAt, setRequiresDueAt] = useState(props.value?.requiresDueAt ?? false);
  const [requiresOutgoingResponse, setRequiresOutgoingResponse] = useState(
    props.value?.requiresOutgoingResponse ?? false,
  );
  const [defaultControl, setDefaultControl] = useState(props.value?.defaultControl ?? false);
  const [defaultDueHours, setDefaultDueHours] = useState(
    props.value?.defaultDueHours != null ? String(props.value.defaultDueHours) : '',
  );
  const [isActive, setIsActive] = useState(props.value?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(String(props.value?.sortOrder ?? 0));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit({
      code: code.trim(),
      nameRu: nameRu.trim(),
      nameTj: nameTj.trim(),
      actionKind,
      requiresExecutor,
      requiresDueAt,
      requiresOutgoingResponse,
      defaultControl,
      defaultDueHours: defaultDueHours ? Number(defaultDueHours) : null,
      isActive,
      sortOrder: Number(sortOrder) || 0,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? t('resolutionTypes.form.createTitle') : t('resolutionTypes.form.editTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="rtype-code">{t('journals.form.code')}</Label>
            <Input
              id="rtype-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!isNew}
              required
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rtype-name-ru">{t('resolutionTypes.form.nameRu')}</Label>
            <Input
              id="rtype-name-ru"
              value={nameRu}
              onChange={(e) => setNameRu(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rtype-name-tj">{t('resolutionTypes.form.nameTj')}</Label>
            <Input
              id="rtype-name-tj"
              value={nameTj}
              onChange={(e) => setNameTj(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rtype-kind">{t('resolutionTypes.columns.kind')}</Label>
            <select
              id="rtype-kind"
              className={controlClass}
              value={actionKind}
              onChange={(e) => setActionKind(e.target.value as ResolutionActionKind)}
            >
              {RESOLUTION_ACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`resolutionActionKind.${k}`)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium text-text">
              {t('resolutionTypes.columns.requires')}
            </legend>
            <Toggle
              label={t('resolutionTypes.flags.executor')}
              checked={requiresExecutor}
              onChange={setRequiresExecutor}
            />
            <Toggle
              label={t('resolutionTypes.flags.due')}
              checked={requiresDueAt}
              onChange={setRequiresDueAt}
            />
            <Toggle
              label={t('resolutionTypes.flags.response')}
              checked={requiresOutgoingResponse}
              onChange={setRequiresOutgoingResponse}
            />
            <Toggle
              label={t('resolutionTypes.flags.control')}
              checked={defaultControl}
              onChange={setDefaultControl}
            />
          </fieldset>

          <div className="flex flex-col gap-1">
            <Label htmlFor="rtype-hours">{t('resolutionTypes.form.defaultDueHours')}</Label>
            <Input
              id="rtype-hours"
              type="number"
              min={1}
              value={defaultDueHours}
              onChange={(e) => setDefaultDueHours(e.target.value)}
            />
            <p className="text-xs text-text-muted">{t('resolutionTypes.form.defaultDueHint')}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rtype-sort">{t('resolutionTypes.form.sortOrder')}</Label>
            <Input
              id="rtype-sort"
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
          <Toggle label={t('common.activeField')} checked={isActive} onChange={setIsActive} />

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

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-[13px] text-text">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}
