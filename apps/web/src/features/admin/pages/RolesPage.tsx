import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Trash2 } from 'lucide-react';
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
  SidePanel,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@cuks/ui';
import type { PermissionCatalogEntry, RoleDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import {
  useCreateRole,
  useDeleteRole,
  usePermissionCatalog,
  useRoles,
  useUpdateRole,
} from '../api/queries';

function groupByModule(catalog: PermissionCatalogEntry[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of catalog) (out[p.module] ??= []).push(p.code);
  return out;
}

function RoleEditor({
  role,
  catalog,
  onClose,
  onCopyAsBase,
}: {
  role: RoleDto;
  catalog: PermissionCatalogEntry[];
  onClose: () => void;
  onCopyAsBase: (perms: string[]) => void;
}) {
  const { t } = useTranslation('admin');
  const update = useUpdateRole();
  const remove = useDeleteRole();
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions));
  const [name, setName] = useState(role.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setPerms(new Set(role.permissions));
    setName(role.name);
  }, [role]);

  const groups = useMemo(() => groupByModule(catalog), [catalog]);
  const readonly = role.isSystem;

  const toggle = (code: string): void =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const save = (): void =>
    update.mutate(
      { id: role.id, input: { name, permissions: [...perms] } },
      {
        onSuccess: () => {
          toast({ title: t('common.saved'), tone: 'success' });
          onClose();
        },
        onError: (e) =>
          toast({
            title: e instanceof ApiError ? e.message : t('common.actionFailed'),
            tone: 'danger',
          }),
      },
    );

  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      closeLabel={t('common.close')}
      title={role.name}
      footer={
        readonly ? (
          <Button className="w-full" variant="outline" onClick={() => onCopyAsBase([...perms])}>
            <Copy /> {t('roles.editor.copyAsBase')}
          </Button>
        ) : (
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              className="text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
            </Button>
            <Button className="flex-1" onClick={save} disabled={update.isPending}>
              {t('common.save')}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge
            tone={role.isSystem ? 'primary' : 'neutral'}
            label={t(role.isSystem ? 'roles.system' : 'roles.custom')}
          />
          <code className="font-mono text-xs text-text-muted">{role.code}</code>
        </div>
        {readonly ? (
          <p className="text-[13px] text-text-muted">{t('roles.editor.systemReadonly')}</p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="rolename">{t('roles.editor.name')}</Label>
            <Input id="rolename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('roles.editor.permissions')}
          </h3>
          {Object.entries(groups).map(([module, codes]) => (
            <div key={module} className="rounded-md border border-border">
              <div className="border-b border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted">
                {module}
              </div>
              <ul className="divide-y divide-border">
                {codes.map((code) => (
                  <li key={code} className="flex items-center gap-2 px-3 py-1.5">
                    <input
                      type="checkbox"
                      id={code}
                      checked={perms.has(code)}
                      disabled={readonly}
                      onChange={() => toggle(code)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <label htmlFor={code} className="font-mono text-xs text-text">
                      {code}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('roles.confirm.deleteTitle')}
        description={t('roles.confirm.deleteBody')}
        entityName={role.name}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(role.id, {
            onSuccess: onClose,
            onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
          })
        }
      />
    </SidePanel>
  );
}

export function RolesPage(): React.JSX.Element {
  const { t } = useTranslation('admin');
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const create = useCreateRole();
  const [selected, setSelected] = useState<RoleDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<{ code: string; name: string; permissions: string[] }>({
    code: '',
    name: '',
    permissions: [],
  });

  // Keep the open editor in sync with refetched role data.
  const liveSelected = selected ? (roles.data?.find((r) => r.id === selected.id) ?? null) : null;

  const openCreate = (permissions: string[] = []): void => {
    setDraft({ code: '', name: '', permissions });
    setSelected(null);
    setCreateOpen(true);
  };
  const submitCreate = (e: FormEvent): void => {
    e.preventDefault();
    create.mutate(
      { code: draft.code, name: draft.name, permissions: draft.permissions },
      {
        onSuccess: (role) => {
          setCreateOpen(false);
          setSelected(role);
        },
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
        title={t('roles.title')}
        description={t('roles.subtitle')}
        actions={
          <Button size="sm" onClick={() => openCreate()}>
            <Plus /> {t('roles.create')}
          </Button>
        }
      />

      {roles.isLoading ? (
        <Skeleton className="h-64 w-full rounded-md" />
      ) : roles.isError ? (
        <div className="rounded-md border border-border py-10 text-center text-[13px] text-text-muted">
          {t('common.loadError')}
        </div>
      ) : (roles.data?.length ?? 0) === 0 ? (
        <EmptyState title={t('roles.empty.title')} description={t('roles.empty.description')} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('roles.columns.name')}</TableHead>
                <TableHead>{t('roles.columns.code')}</TableHead>
                <TableHead className="w-32">{t('roles.columns.type')}</TableHead>
                <TableHead className="w-20">{t('roles.columns.permissions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data?.map((r) => (
                <TableRow key={r.id} onClick={() => setSelected(r)} className="cursor-pointer">
                  <TableCell className="font-medium text-text">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs text-text-muted">{r.code}</TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={r.isSystem ? 'primary' : 'neutral'}
                      label={t(r.isSystem ? 'roles.system' : 'roles.custom')}
                    />
                  </TableCell>
                  <TableCell className="text-text-muted">{r.permissions.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {liveSelected ? (
        <RoleEditor
          role={liveSelected}
          catalog={catalog.data ?? []}
          onClose={() => setSelected(null)}
          onCopyAsBase={(perms) => openCreate(perms)}
        />
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('roles.editor.titleNew')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rc" required>
                {t('roles.editor.name')}
              </Label>
              <Input
                id="rc"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rcode" required>
                {t('roles.editor.code')}
              </Label>
              <Input
                id="rcode"
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                placeholder={t('roles.editor.codePlaceholder')}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || !draft.name || !draft.code}>
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
