import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, Loader2, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from '@cuks/ui';
import type { AclLevel, FsNodeDto, NodeAclEntryDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import {
  useCreateLink,
  useDirectoryUsers,
  useGrantAcl,
  useNodeAcl,
  useNodeLinks,
  useRevokeAcl,
  useRevokeLink,
} from '../api/queries';
import { formatDateTime } from '../lib';

const LEVELS: AclLevel[] = ['viewer', 'editor', 'manager'];

interface ShareDialogProps {
  node: FsNodeDto | null;
  onClose: () => void;
}

export function ShareDialog({ node, onClose }: ShareDialogProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const nodeId = node?.id ?? null;

  const acl = useNodeAcl(nodeId);
  const links = useNodeLinks(nodeId);
  const grant = useGrantAcl();
  const revoke = useRevokeAcl();
  const createLink = useCreateLink();
  const revokeLink = useRevokeLink();

  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<AclLevel>('viewer');
  const people = useDirectoryUsers(search);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const onError = (err: unknown): void => {
    toast({
      title: t('share.title', { name: node?.name ?? '' }),
      description: err instanceof ApiError ? err.message : String(err),
      tone: 'danger',
    });
  };

  const addUser = (userId: string): void => {
    if (!nodeId) return;
    grant.mutate(
      { id: nodeId, input: { subjectType: 'user', subjectId: userId, level } },
      { onSuccess: () => setSearch(''), onError },
    );
  };

  const removeGrant = (entry: NodeAclEntryDto): void => {
    if (!nodeId) return;
    revoke.mutate(
      { id: nodeId, input: { subjectType: entry.subjectType, subjectId: entry.subjectId } },
      { onError },
    );
  };

  const copyLink = async (url: string, id: string): Promise<void> => {
    const absolute = `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast({ title: t('share.link.copy'), description: absolute });
    }
  };

  const existingUserIds = new Set(
    (acl.data?.entries ?? []).filter((e) => e.subjectType === 'user').map((e) => e.subjectId),
  );

  return (
    <Dialog open={!!node} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('share.title', { name: node?.name ?? '' })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Add a person */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('share.addPeople')}
                className="h-9 flex-1"
              />
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as AclLevel)}
                aria-label={t('share.grant')}
                className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-text"
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`share.level.${l}`)}
                  </option>
                ))}
              </select>
            </div>
            {search.trim() ? (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                {people.isLoading ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-text-muted" />
                  </div>
                ) : (people.data ?? []).length === 0 ? (
                  <div className="py-3 text-center text-xs text-text-muted">—</div>
                ) : (
                  (people.data ?? []).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      disabled={existingUserIds.has(u.id) || grant.isPending}
                      onClick={() => addUser(u.id)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-surface-2 disabled:opacity-40"
                    >
                      <span className="truncate">
                        {u.shortName}{' '}
                        <span className="font-mono text-xs text-text-muted">@{u.username}</span>
                      </span>
                      {existingUserIds.has(u.id) ? <Check className="size-4 text-success" /> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {/* Current access */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t('share.current')}
            </div>
            {(acl.data?.entries ?? []).length === 0 && (acl.data?.inherited ?? []).length === 0 ? (
              <div className="text-[13px] text-text-muted">{t('share.noGrants')}</div>
            ) : (
              <ul className="space-y-1">
                {(acl.data?.entries ?? []).map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-2"
                  >
                    <span className="truncate text-[13px]">{e.subjectName}</span>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{t(`share.level.${e.level as AclLevel}`)}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t('share.revoke')}
                        onClick={() => removeGrant(e)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
                {(acl.data?.inherited ?? []).map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-2 py-1.5">
                    <span className="truncate text-[13px] text-text-muted">{e.subjectName}</span>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{t(`share.level.${e.level as AclLevel}`)}</Badge>
                      <Badge tone="info">{t('share.inherited')}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Internal links */}
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {t('share.link.title')}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={createLink.isPending || !nodeId}
                onClick={() =>
                  nodeId && createLink.mutate({ id: nodeId, expiresInDays: null }, { onError })
                }
              >
                <Link2 className="size-4" /> {t('share.link.create')}
              </Button>
            </div>
            <p className="text-xs text-text-muted">{t('share.link.hint')}</p>
            {(links.data ?? []).length === 0 ? (
              <div className="text-[13px] text-text-muted">{t('share.link.none')}</div>
            ) : (
              <ul className="space-y-1">
                {(links.data ?? []).map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1.5"
                  >
                    <span className="truncate font-mono text-xs text-text-muted">
                      …{link.token.slice(-8)}
                      <span className="ml-2 font-sans">
                        {link.expiresAt
                          ? t('share.link.expires', { date: formatDateTime(link.expiresAt) })
                          : t('share.link.never')}
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t('share.link.copy')}
                        onClick={() => void copyLink(link.url, link.id)}
                      >
                        {copiedId === link.id ? (
                          <Check className="size-3.5 text-success" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t('share.link.revoke')}
                        onClick={() =>
                          nodeId && revokeLink.mutate({ id: nodeId, linkId: link.id }, { onError })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
