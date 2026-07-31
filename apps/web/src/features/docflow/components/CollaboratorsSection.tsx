import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Users, X } from 'lucide-react';
import { Button, Input, Label, cn, toast } from '@cuks/ui';
import {
  DOCUMENT_COLLABORATOR_ROLES,
  type DocumentCollaboratorRole,
  type DocumentDetailDto,
} from '@cuks/shared';
import { useAddCollaborator, useDirectoryUsers, useRemoveCollaborator } from '../api/queries';

const fieldClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * Who besides the author works on the document (docs/modules/11 §12.5). Visible to anyone
 * who can open the card — knowing who prepares a document is part of it — but only the
 * author (`manageCollaborators`) sees the controls.
 */
export function CollaboratorsSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const add = useAddCollaborator(doc.id);
  const remove = useRemoveCollaborator(doc.id);
  const [role, setRole] = useState<DocumentCollaboratorRole>('preparer');
  const [search, setSearch] = useState('');
  // Server-side search — the directory list is capped, so anyone stays reachable.
  const directory = useDirectoryUsers(search);
  const canManage = doc.availableActions.includes('manageCollaborators');
  const alreadyIn = new Set(doc.collaborators.map((c) => c.userId));

  const invite = (userId: string) => {
    add.mutate(
      { userId, role },
      {
        onSuccess: () => {
          setSearch('');
          toast({ title: t('collaborators.added'), tone: 'success' });
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Users className="size-4" aria-hidden /> {t('collaborators.title')}
      </h2>

      {doc.collaborators.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('collaborators.empty')}</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1.5">
          {doc.collaborators.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[13px] text-text">
              <span className="min-w-0 flex-1 truncate">{c.userName ?? c.userId}</span>
              <span className="rounded bg-surface-2 px-1.5 text-[11px] text-text-muted">
                {t(`collaborators.role.${c.role}`)}
              </span>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  aria-label={t('collaborators.remove', { name: c.userName ?? c.userId })}
                  onClick={() =>
                    remove.mutate(c.id, {
                      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
                    })
                  }
                >
                  <X className="size-4 text-danger" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="collaborator-role">{t('collaborators.roleLabel')}</Label>
            <select
              id="collaborator-role"
              className={fieldClass}
              value={role}
              onChange={(e) => setRole(e.target.value as DocumentCollaboratorRole)}
            >
              {DOCUMENT_COLLABORATOR_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`collaborators.role.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="collaborator-user">{t('collaborators.add')}</Label>
            <Input
              id="collaborator-user"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('collaborators.searchPlaceholder')}
            />
            {search.trim() ? (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-border">
                {directory.isLoading ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-text-muted" aria-hidden />
                  </div>
                ) : (directory.data ?? []).length === 0 ? (
                  <div className="py-3 text-center text-xs text-text-muted">—</div>
                ) : (
                  (directory.data ?? []).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      disabled={add.isPending || alreadyIn.has(u.id) || u.id === doc.authorId}
                      onClick={() => invite(u.id)}
                      className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-2 disabled:opacity-40"
                    >
                      <span className="truncate">
                        {u.shortName}{' '}
                        <span className="font-mono text-xs text-text-muted">@{u.username}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
