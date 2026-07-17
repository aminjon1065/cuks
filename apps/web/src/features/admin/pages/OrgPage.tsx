import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
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
  OrgUnitPicker,
  PageHeader,
  SidePanel,
  Skeleton,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import { ORG_UNIT_TYPES, type OrgUnitTreeNode } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  useCreateOrgUnit,
  useCreatePosition,
  useDeleteOrgUnit,
  useDeletePosition,
  useMoveOrgUnit,
  useOrgTree,
  usePositions,
  useUpdateOrgUnit,
} from '../api/queries';

function findNode(nodes: OrgUnitTreeNode[], id: string): OrgUnitTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = n.children ? findNode(n.children, id) : null;
    if (f) return f;
  }
  return null;
}
function flatten(nodes: OrgUnitTreeNode[]): { id: string; name: string }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name }, ...flatten(n.children ?? [])]);
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: OrgUnitTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(node.id)}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-[13px] hover:bg-surface-2',
          node.id === selectedId && 'bg-primary/10 text-primary',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-text-muted"
            aria-label="toggle"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="size-3.5" />
        )}
        <span className="flex-1 truncate font-medium">{node.name}</span>
        <span className="text-xs text-text-muted">
          {node.employeeCount} {t('org.employees')}
        </span>
      </div>
      {hasChildren && open
        ? node.children.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  );
}

function UnitPanel({
  node,
  tree,
  onClose,
  onAddChild,
}: {
  node: OrgUnitTreeNode;
  tree: OrgUnitTreeNode[];
  onClose: () => void;
  onAddChild: (parentId: string) => void;
}) {
  const { t } = useTranslation('admin');
  const update = useUpdateOrgUnit();
  const move = useMoveOrgUnit();
  const remove = useDeleteOrgUnit();
  const positions = usePositions(node.id);
  const createPos = useCreatePosition();
  const deletePos = useDeletePosition();
  const [name, setName] = useState(node.name);
  const [shortName, setShortName] = useState(node.shortName ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const [newPos, setNewPos] = useState('');

  useEffect(() => {
    setName(node.name);
    setShortName(node.shortName ?? '');
  }, [node]);
  const fail = (e: unknown): void => {
    toast({ title: e instanceof ApiError ? e.message : t('common.actionFailed'), tone: 'danger' });
  };
  const ok = (): void => {
    toast({ title: t('common.saved'), tone: 'success' });
  };

  const save = (): void =>
    update.mutate(
      { id: node.id, input: { name, shortName: shortName || null } },
      { onSuccess: ok, onError: fail },
    );

  const addPosition = (e: FormEvent): void => {
    e.preventDefault();
    if (!newPos.trim()) return;
    createPos.mutate(
      { orgUnitId: node.id, name: newPos.trim() },
      {
        onSuccess: () => {
          setNewPos('');
          ok();
        },
        onError: fail,
      },
    );
  };

  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      closeLabel={t('common.close')}
      title={node.name}
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="uname">{t('org.unit.name')}</Label>
            <Input id="uname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ushort">{t('org.unit.shortName')}</Label>
            <Input id="ushort" value={shortName} onChange={(e) => setShortName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('org.unit.parent')}</Label>
            <OrgUnitPicker
              tree={flatten(tree).filter((n) => n.id !== node.id)}
              value={node.parentId}
              onChange={(parentId) =>
                move.mutate({ id: node.id, input: { parentId } }, { onSuccess: ok, onError: fail })
              }
              placeholder="—"
              clearable
            />
          </div>
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {t('common.save')}
          </Button>
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('org.unit.positions')}
          </h3>
          {positions.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (positions.data?.length ?? 0) === 0 ? (
            <p className="text-[13px] text-text-muted">{t('org.unit.noPositions')}</p>
          ) : (
            <ul className="space-y-1">
              {positions.data?.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px]">
                  <span className="text-text">{p.name}</span>
                  {p.isHead ? (
                    <StatusBadge tone="primary" label={t('org.position.headShort')} />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => deletePos.mutate(p.id, { onError: fail })}
                    className="ml-auto text-text-muted hover:text-danger"
                    aria-label={t('common.delete')}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addPosition} className="flex gap-2 pt-1">
            <Input
              value={newPos}
              onChange={(e) => setNewPos(e.target.value)}
              placeholder={t('org.position.name')}
              className="h-8"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!newPos.trim() || createPos.isPending}
            >
              <Plus />
            </Button>
          </form>
        </section>

        <section className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={() => onAddChild(node.id)}>
            <Plus /> {t('org.addChild')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-danger"
            onClick={() => setConfirmDel(true)}
          >
            <Trash2 /> {t('common.delete')}
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={t('org.confirm.deleteUnitTitle')}
        description={t('org.confirm.deleteUnitBody')}
        entityName={node.name}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(node.id, { onSuccess: onClose, onError: fail })}
      />
    </SidePanel>
  );
}

export function OrgPage(): React.JSX.Element {
  const { t } = useTranslation('admin');
  useDocumentTitle(t('org.title'));
  const tree = useOrgTree();
  const create = useCreateOrgUnit();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<{ name: string; type: string }>({
    name: '',
    type: 'division',
  });

  const selected = selectedId && tree.data ? findNode(tree.data, selectedId) : null;

  const openCreate = (parentId: string | null): void => {
    setCreateParent(parentId);
    setDraft({ name: '', type: parentId ? 'division' : 'committee' });
  };
  const submitCreate = (e: FormEvent): void => {
    e.preventDefault();
    create.mutate(
      {
        name: draft.name,
        type: draft.type as (typeof ORG_UNIT_TYPES)[number],
        parentId: createParent ?? null,
      },
      {
        onSuccess: () => setCreateParent(undefined),
        onError: (err) =>
          toast({
            title: err instanceof ApiError ? err.message : t('common.actionFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('org.title')}
        description={t('org.subtitle')}
        actions={
          <Button size="sm" onClick={() => openCreate(null)}>
            <Plus /> {t('org.addRoot')}
          </Button>
        }
      />

      {tree.isLoading ? (
        <Skeleton className="h-64 w-full rounded-md" />
      ) : tree.isError ? (
        <div className="rounded-md border border-border py-10 text-center text-[13px] text-text-muted">
          {t('common.loadError')}
        </div>
      ) : (tree.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('org.empty.title')}
          description={t('org.empty.description')}
        />
      ) : (
        <div className="max-w-2xl rounded-lg border border-border bg-surface p-2">
          {tree.data?.map((n) => (
            <TreeRow
              key={n.id}
              node={n}
              depth={0}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      {selected ? (
        <UnitPanel
          node={selected}
          tree={tree.data ?? []}
          onClose={() => setSelectedId(null)}
          onAddChild={(id) => openCreate(id)}
        />
      ) : null}

      <Dialog
        open={createParent !== undefined}
        onOpenChange={(o) => !o && setCreateParent(undefined)}
      >
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('org.unit.titleNew')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="on" required>
                {t('org.unit.name')}
              </Label>
              <Input
                id="on"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ot">{t('org.unit.type')}</Label>
              <select
                id="ot"
                value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px] text-text"
              >
                {ORG_UNIT_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`org.types.${ty}`)}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateParent(undefined)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || !draft.name.trim()}>
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
