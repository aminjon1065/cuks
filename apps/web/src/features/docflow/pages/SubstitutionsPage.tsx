import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, UserPlus, X } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import type { SubstitutionDto } from '@cuks/shared';
import { useMe } from '@/features/auth/api/queries';
import { formatDate } from '@/lib/format';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  useCreateSubstitution,
  useDirectoryUsers,
  useRemoveSubstitution,
  useSubstitutions,
} from '../api/queries';

const inputClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** «Замещения» (docs/05-auth-rbac.md §6, task 3.11): a user delegates their route duties to a
 *  deputy for a period, and sees whom they themselves cover. */
export function SubstitutionsPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('substitutions.title'));
  const me = useMe();
  const list = useSubstitutions();

  const mine = (list.data ?? []).filter((s) => s.principalId === me.data?.id);
  const covering = (list.data ?? []).filter((s) => s.deputyId === me.data?.id);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('substitutions.title')} description={t('substitutions.subtitle')} />

      {list.isPending ? (
        <Skeleton className="h-24 w-full rounded-md" />
      ) : list.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title={t('common.loadError')}
          description={t('common.loadErrorHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <>
          <CreateForm />
          <Group title={t('substitutions.mine')} rows={mine} canManage />
          <Group title={t('substitutions.covering')} rows={covering} canManage={false} />
        </>
      )}
    </div>
  );
}

function CreateForm(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const create = useCreateSubstitution();
  const me = useMe();
  const [deputy, setDeputy] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const directory = useDirectoryUsers(search);
  const results = useMemo(
    () => (directory.data ?? []).filter((u) => u.id !== me.data?.id),
    [directory.data, me.data?.id],
  );

  const submit = (): void => {
    if (!deputy || !me.data) return;
    create.mutate(
      {
        principalId: me.data.id,
        deputyId: deputy.id,
        scope: 'docflow',
        startsAt: startsAt ? `${startsAt}T00:00:00+05:00` : undefined,
        endsAt: endsAt ? `${endsAt}T23:59:59+05:00` : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: t('substitutions.createdToast'), tone: 'success' });
          setDeputy(null);
          setSearch('');
          setStartsAt('');
          setEndsAt('');
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <UserPlus className="size-4" /> {t('substitutions.create')}
      </h2>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label>{t('substitutions.deputy')}</Label>
          {deputy ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-text">{deputy.name}</span>
              <button
                type="button"
                className="text-text-muted hover:text-danger"
                onClick={() => setDeputy(null)}
                aria-label={t('common.cancel')}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('substitutions.searchDeputy')}
              />
              {search.trim() ? (
                <div className="max-h-36 overflow-y-auto rounded-sm border border-border">
                  {results.length === 0 ? (
                    <div className="py-2 text-center text-xs text-text-muted">—</div>
                  ) : (
                    results.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setDeputy({ id: u.id, name: u.shortName });
                          setSearch('');
                        }}
                        className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                      >
                        {u.shortName}
                        <span className="ml-1.5 font-mono text-xs text-text-muted">
                          @{u.username}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="sub-from">{t('substitutions.from')}</Label>
            <input
              id="sub-from"
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="sub-to">{t('substitutions.to')}</Label>
            <input
              id="sub-to"
              type="date"
              value={endsAt}
              min={startsAt || undefined}
              onChange={(e) => setEndsAt(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <Button disabled={!deputy || create.isPending} onClick={submit}>
              {t('substitutions.add')}
            </Button>
          </div>
        </div>
        <p className="text-xs text-text-muted">{t('substitutions.hint')}</p>
      </div>
    </section>
  );
}

function Group({
  title,
  rows,
  canManage,
}: {
  title: string;
  rows: SubstitutionDto[];
  canManage: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const remove = useRemoveSubstitution();
  const [toRemove, setToRemove] = useState<SubstitutionDto | null>(null);

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-text">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState title={t('substitutions.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-[13px]">
              <StatusBadge
                tone={s.active ? 'success' : 'neutral'}
                label={t(s.active ? 'substitutions.active' : 'substitutions.inactive')}
              />
              <span className="text-text">{canManage ? s.deputyName : s.principalName}</span>
              <span className="text-xs text-text-muted">
                {s.startsAt || s.endsAt
                  ? `${s.startsAt ? formatDate(s.startsAt) : '…'} — ${s.endsAt ? formatDate(s.endsAt) : '…'}`
                  : t('substitutions.openEnded')}
              </span>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={remove.isPending}
                  onClick={() => setToRemove(s)}
                >
                  {t('substitutions.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('substitutions.removeConfirm.title')}
        description={t('substitutions.removeConfirm.description', {
          name: toRemove?.deputyName ?? '',
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={() => {
          if (!toRemove) return;
          remove.mutate(toRemove.id, {
            onSuccess: () => {
              toast({ title: t('substitutions.removedToast'), tone: 'success' });
              setToRemove(null);
            },
            onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
          });
        }}
      />
    </section>
  );
}
