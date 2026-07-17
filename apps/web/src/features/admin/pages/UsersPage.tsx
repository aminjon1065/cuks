import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus, Users2 } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  EmptyState,
  FilterBar,
  Input,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@cuks/ui';
import type { ListUsersQuery, UserStatus } from '@cuks/shared';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useOrgTree, useRoles, useUsers } from '../api/queries';
import { formatDateTime } from '../lib';
import { CreateUserDialog } from '../components/CreateUserDialog';
import { UserDetailPanel } from '../components/UserDetailPanel';

const PAGE = 25;

export function UsersPage(): React.JSX.Element {
  const { t } = useTranslation('admin');
  useDocumentTitle(t('users.title'));
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query: ListUsersQuery = {
    page,
    limit: PAGE,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  };
  const list = useUsers(query);
  const roles = useRoles();
  const orgTree = useOrgTree();

  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const hasFilters = !!(search || status);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button size="sm" data-testid="users-create" onClick={() => setCreateOpen(true)}>
            <Plus /> {t('users.create')}
          </Button>
        }
      />

      <FilterBar
        resetLabel={t('common.reset')}
        {...(hasFilters
          ? {
              onReset: () => {
                setSearch('');
                setStatus('');
                setPage(1);
              },
            }
          : {})}
      >
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t('users.searchPlaceholder')}
          data-testid="users-search"
          className="h-8 w-64"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as UserStatus | '');
            setPage(1);
          }}
          aria-label={t('users.card.statusFilter')}
          className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text"
        >
          <option value="">—</option>
          <option value="active">{t('users.status.active')}</option>
          <option value="blocked">{t('users.status.blocked')}</option>
        </select>
      </FilterBar>

      {list.isLoading ? (
        <Skeleton className="h-72 w-full rounded-md" />
      ) : list.isError ? (
        <div className="rounded-md border border-border py-10 text-center text-[13px] text-text-muted">
          {t('common.loadError')}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={Users2}
          title={t('users.empty.title')}
          description={t('users.empty.description')}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('users.columns.user')}</TableHead>
                <TableHead>{t('users.columns.position')}</TableHead>
                <TableHead>{t('users.columns.roles')}</TableHead>
                <TableHead className="w-28">{t('users.columns.status')}</TableHead>
                <TableHead className="w-32">{t('users.columns.lastLogin')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((u) => (
                <TableRow key={u.id} onClick={() => setSelectedId(u.id)} className="cursor-pointer">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarFallback>{u.shortName.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-text">
                          {u.fullName}
                        </div>
                        <div className="truncate font-mono text-xs text-text-muted">
                          @{u.username}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-text-muted">{u.primaryPosition ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.slice(0, 2).map((r) => (
                        <Badge key={r} tone="neutral">
                          {r}
                        </Badge>
                      ))}
                      {u.roles.length > 2 ? (
                        <Badge tone="neutral">+{u.roles.length - 2}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={u.status === 'active' ? 'success' : 'danger'}
                      label={t(`users.status.${u.status}`)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-text-muted">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.neverLoggedIn')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <span>
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="prev"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            aria-label="next"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      {selectedId ? (
        <UserDetailPanel
          userId={selectedId}
          roles={roles.data ?? []}
          orgTree={orgTree.data ?? []}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}
