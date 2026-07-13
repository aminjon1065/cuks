import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldOff, Trash2, X } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  OrgUnitPicker,
  SidePanel,
  Skeleton,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import type { OrgUnitTreeNode, RoleDto, TempPasswordDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import {
  useAssignRole,
  useDeleteUser,
  useResetPassword,
  useRevokeRole,
  useRoleAssignments,
  useUser,
  useUserAction,
} from '../api/queries';
import { TempPasswordView } from './TempPasswordView';

type Confirm = null | 'block' | 'unblock' | 'delete' | 'resetPw' | 'resetTotp';

function toTree(nodes: OrgUnitTreeNode[]): { id: string; name: string; children?: never[] }[] {
  return nodes.map((n) => ({ id: n.id, name: n.name }));
}

export function UserDetailPanel({
  userId,
  roles,
  orgTree,
  onClose,
}: {
  userId: string;
  roles: RoleDto[];
  orgTree: OrgUnitTreeNode[];
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation('common');
  const user = useUser(userId);
  const assignments = useRoleAssignments(userId);
  const resetPassword = useResetPassword();
  const resetTotp = useUserAction('reset-totp');
  const block = useUserAction('block');
  const unblock = useUserAction('unblock');
  const remove = useDeleteUser();
  const assignRole = useAssignRole();
  const revokeRole = useRevokeRole();

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [tempPw, setTempPw] = useState<TempPasswordDto | null>(null);
  const [newRoleId, setNewRoleId] = useState('');
  const [scopeId, setScopeId] = useState<string | null>(null);

  const fail = (e: unknown): void => {
    toast({ title: e instanceof ApiError ? e.message : tc('actions.retry'), tone: 'danger' });
  };
  const ok = (): void => {
    toast({ title: t('common.saved'), tone: 'success' });
  };

  const doAssignRole = (): void => {
    if (!newRoleId) return;
    assignRole.mutate(
      { userId, roleId: newRoleId, ...(scopeId ? { orgUnitId: scopeId } : {}) },
      {
        onSuccess: () => {
          setNewRoleId('');
          setScopeId(null);
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
      title={user.data?.shortName ?? t('users.title')}
      footer={
        user.data ? (
          user.data.status === 'blocked' ? (
            <Button className="w-full" onClick={() => setConfirm('unblock')}>
              {t('users.card.unblock')}
            </Button>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setConfirm('block')}>
              {t('users.card.block')}
            </Button>
          )
        ) : null
      }
    >
      {user.isLoading || !user.data ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Profile */}
          <section className="space-y-1.5">
            <div className="text-lg font-semibold text-text">{user.data.fullName}</div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
              <span className="font-mono">@{user.data.username}</span>
              <StatusBadge
                tone={user.data.status === 'active' ? 'success' : 'danger'}
                label={t(`users.status.${user.data.status}`)}
              />
              <StatusBadge
                tone={user.data.totpEnabled ? 'success' : 'neutral'}
                label={`2ФА: ${user.data.totpEnabled ? t('users.twofa.on') : t('users.twofa.off')}`}
              />
            </div>
            {user.data.email ? (
              <div className="text-[13px] text-text-muted">{user.data.email}</div>
            ) : null}
          </section>

          {/* Positions */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('users.card.positions')}
            </h3>
            {user.data.positions.length === 0 ? (
              <p className="text-[13px] text-text-muted">{t('users.card.noPositions')}</p>
            ) : (
              <ul className="space-y-1">
                {user.data.positions.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-[13px] text-text">
                    <span>{p.positionName}</span>
                    <span className="text-text-muted">· {p.orgUnitName}</span>
                    {p.isPrimary ? (
                      <StatusBadge tone="primary" label={t('users.card.primary')} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Roles */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('users.card.roles')}
            </h3>
            {assignments.data && assignments.data.length > 0 ? (
              <ul className="space-y-1">
                {assignments.data.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[13px]">
                    <span className="text-text">{a.roleName}</span>
                    <span className="text-text-muted">
                      · {a.orgUnitName ?? t('users.card.global')}
                    </span>
                    <button
                      type="button"
                      onClick={() => revokeRole.mutate(a.id, { onError: fail })}
                      className="ml-auto text-text-muted hover:text-danger"
                      aria-label={t('common.delete')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-muted">{t('users.card.noRoles')}</p>
            )}
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <select
                value={newRoleId}
                onChange={(e) => setNewRoleId(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-text"
              >
                <option value="">{t('users.card.assignRole')}…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <div className="w-44">
                <OrgUnitPicker
                  tree={toTree(orgTree)}
                  value={scopeId}
                  onChange={setScopeId}
                  placeholder={t('users.card.global')}
                />
              </div>
              <Button
                size="sm"
                disabled={!newRoleId || assignRole.isPending}
                onClick={doAssignRole}
              >
                {t('common.confirm')}
              </Button>
            </div>
          </section>

          {/* Actions */}
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('users.card.actions')}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirm('resetPw')}>
                <KeyRound /> {t('users.card.resetPassword')}
              </Button>
              {user.data.totpEnabled ? (
                <Button variant="outline" size="sm" onClick={() => setConfirm('resetTotp')}>
                  <ShieldOff /> {t('users.card.resetTotp')}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className={cn('text-danger')}
                onClick={() => setConfirm('delete')}
              >
                <Trash2 /> {t('common.delete')}
              </Button>
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'block'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('users.confirm.blockTitle')}
        description={t('users.confirm.blockBody')}
        entityName={user.data?.fullName}
        confirmLabel={t('users.card.block')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        loading={block.isPending}
        onConfirm={() =>
          block.mutate(userId, {
            onSuccess: () => {
              setConfirm(null);
              ok();
            },
            onError: fail,
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'unblock'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('users.card.unblock')}
        entityName={user.data?.fullName}
        confirmLabel={t('users.card.unblock')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        destructive={false}
        loading={unblock.isPending}
        onConfirm={() =>
          unblock.mutate(userId, {
            onSuccess: () => {
              setConfirm(null);
              ok();
            },
            onError: fail,
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'resetPw'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('users.confirm.resetPwTitle')}
        description={t('users.confirm.resetPwBody')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        destructive={false}
        loading={resetPassword.isPending}
        onConfirm={() =>
          resetPassword.mutate(userId, {
            onSuccess: (data) => {
              setConfirm(null);
              setTempPw(data);
            },
            onError: fail,
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'resetTotp'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('users.confirm.resetTotpTitle')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        destructive={false}
        loading={resetTotp.isPending}
        onConfirm={() =>
          resetTotp.mutate(userId, {
            onSuccess: () => {
              setConfirm(null);
              ok();
            },
            onError: fail,
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('users.confirm.deleteTitle')}
        description={t('users.confirm.deleteBody')}
        entityName={user.data?.fullName}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(userId, {
            onSuccess: () => {
              setConfirm(null);
              onClose();
            },
            onError: fail,
          })
        }
      />

      <Dialog open={!!tempPw} onOpenChange={(o) => !o && setTempPw(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('users.tempPassword.resetTitle')}</DialogTitle>
          </DialogHeader>
          {tempPw ? <TempPasswordView data={tempPw} /> : null}
          <DialogFooter>
            <Button onClick={() => setTempPw(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidePanel>
  );
}
