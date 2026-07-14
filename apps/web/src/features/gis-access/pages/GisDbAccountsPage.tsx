import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  Badge,
  Button,
  cn,
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
  toast,
} from '@cuks/ui';
import {
  GIS_DB_ACCOUNT_KINDS,
  type GisDbAccountDto,
  type GisDbAccountKind,
  type GisDbAccountSecretDto,
} from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import { CopyField } from '../components/CopyField';
import { useCreateGisDbAccount, useDeleteGisDbAccount, useGisDbAccounts } from '../api/queries';

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * Admin → «Доступ ГИС» (docs/modules/10 §7, docs/09 §Права PG; task 2.9). Issue and
 * revoke scoped PostGIS login roles for direct QGIS/ArcGIS access. The password is
 * shown once at creation and never again — the UI makes that explicit.
 */
export function GisDbAccountsPage(): React.JSX.Element {
  const { t } = useTranslation('gisAccess');
  const canManage = useCan('gis.pg.access');
  const accounts = useGisDbAccounts();
  const create = useCreateGisDbAccount();
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<GisDbAccountSecretDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GisDbAccountDto | null>(null);
  const remove = useDeleteGisDbAccount();

  useEffect(() => {
    document.title = t('accounts.title');
  }, [t]);

  if (!canManage) return <ForbiddenPage />;

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast({ title: t('accounts.deleted'), tone: 'success' });
      },
      onError: (error) =>
        toast({
          title: error instanceof ApiError ? error.message : t('accounts.deleteFailed'),
          tone: 'danger',
        }),
    });
  };

  const list = accounts.data ?? [];

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-y-auto p-6">
      <PageHeader
        title={t('accounts.title')}
        description={t('accounts.subtitle')}
        actions={
          <Button size="sm" data-testid="create-db-account" onClick={() => setCreateOpen(true)}>
            <Plus /> {t('accounts.create')}
          </Button>
        }
      />

      <div className="mt-6">
        {accounts.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t('accounts.emptyTitle')}
            description={t('accounts.emptyDescription')}
          />
        ) : (
          <ul
            className="divide-y divide-border rounded-lg border border-border"
            data-testid="db-account-list"
          >
            {list.map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="size-4 shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate font-mono text-[13px] text-text">
                      {account.username}
                    </code>
                    <Badge tone={account.kind === 'editor' ? 'warning' : 'neutral'}>
                      {t(`accounts.kind.${account.kind}`)}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-text-muted">
                    {account.note ? `${account.note} · ` : ''}
                    {formatDateTime(account.createdAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-text-muted hover:text-danger"
                  onClick={() => setPendingDelete(account)}
                  aria-label={t('accounts.revoke', { name: account.username })}
                  title={t('accounts.revoke', { name: account.username })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateAccountDialog
        create={create}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          setCreateOpen(false);
          setSecret(created);
        }}
      />

      <SecretDialog
        secret={secret}
        onClose={() => {
          setSecret(null);
          // The password lives in the create-mutation's cached result too; drop it
          // so it doesn't linger in memory after the one-time reveal is dismissed.
          create.reset();
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('accounts.revokeTitle')}
        description={t('accounts.revokeDescription')}
        {...(pendingDelete ? { entityName: pendingDelete.username } : {})}
        confirmLabel={t('accounts.revokeConfirm')}
        cancelLabel={t('accounts.cancel')}
        closeLabel={t('accounts.cancel')}
        loading={remove.isPending}
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CreateAccountDialog({
  create,
  open,
  onOpenChange,
  onCreated,
}: {
  create: ReturnType<typeof useCreateGisDbAccount>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (account: GisDbAccountSecretDto) => void;
}): React.JSX.Element {
  const { t } = useTranslation('gisAccess');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<GisDbAccountKind>('reader');
  const [note, setNote] = useState('');

  const close = (): void => {
    onOpenChange(false);
    setLabel('');
    setKind('reader');
    setNote('');
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!label.trim()) return;
    create.mutate(
      { label: label.trim(), kind, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: (account) => {
          onCreated(account);
          setLabel('');
          setKind('reader');
          setNote('');
        },
        onError: (error) =>
          toast({
            title: error instanceof ApiError ? error.message : t('accounts.createFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('accounts.cancel')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('accounts.create')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="db-account-label">{t('accounts.label')}</Label>
            <Input
              id="db-account-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t('accounts.labelPlaceholder')}
              maxLength={40}
              required
              autoFocus
            />
            <p className="text-xs text-text-muted">{t('accounts.labelHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="db-account-kind">{t('accounts.kindLabel')}</Label>
            <select
              id="db-account-kind"
              className={selectClass}
              value={kind}
              onChange={(event) => setKind(event.target.value as GisDbAccountKind)}
            >
              {GIS_DB_ACCOUNT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`accounts.kindOption.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="db-account-note">{t('accounts.note')}</Label>
            <Input
              id="db-account-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('accounts.notePlaceholder')}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t('accounts.cancel')}
            </Button>
            <Button type="submit" disabled={!label.trim() || create.isPending}>
              {t('accounts.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The one-time password reveal. Closing it loses the password for good. */
function SecretDialog({
  secret,
  onClose,
}: {
  secret: GisDbAccountSecretDto | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('gisAccess');
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('accounts.close')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('accounts.secretTitle')}</DialogTitle>
        </DialogHeader>
        {secret && (
          <div className="space-y-3" data-testid="db-account-secret">
            <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-3 text-[13px] text-text">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              {t('accounts.secretWarning')}
            </div>
            <CopyField
              label={t('accounts.username')}
              value={secret.username}
              testId="secret-username"
            />
            <CopyField
              label={t('accounts.password')}
              value={secret.password}
              testId="secret-password"
            />
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t('accounts.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
