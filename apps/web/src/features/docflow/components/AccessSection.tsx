import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Lock, ShieldCheck, X } from 'lucide-react';
import { Button, EmptyState, Input, Skeleton, Switch, cn, toast } from '@cuks/ui';
import type { DocumentAccessMemberDto, DocumentDetailDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import {
  useDirectoryUsers,
  useDocumentAccess,
  useDocumentReadLog,
  useSetDocumentAccess,
} from '../api/queries';

/** The card «Доступ» block (docs/09-security.md §3, task 3.10): the confidentiality grif and
 *  ДСП allow-list, with management for the author / a confidential.view holder, and the read
 *  trail of who has opened a restricted document. */
export function AccessSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const access = useDocumentAccess(doc.id);

  if (access.isPending) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <Skeleton className="h-16 w-full rounded-md" />
      </section>
    );
  }
  if (access.isError || !access.data) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      </section>
    );
  }

  return <AccessBody doc={doc} data={access.data} />;
}

function AccessBody({
  doc,
  data,
}: {
  doc: DocumentDetailDto;
  data: NonNullable<ReturnType<typeof useDocumentAccess>['data']>;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const save = useSetDocumentAccess(doc.id);
  const [editing, setEditing] = useState(false);
  const [dsp, setDsp] = useState(data.confidentiality === 'dsp');
  const [members, setMembers] = useState<DocumentAccessMemberDto[]>(data.members);
  const [search, setSearch] = useState('');
  const directory = useDirectoryUsers(search);

  const isDsp = data.confidentiality === 'dsp';
  // A normal document a viewer cannot manage has nothing to show or do — keep the overview clean.
  if (!isDsp && !data.canManage) return <></>;
  const results = (directory.data ?? []).filter((u) => !members.some((m) => m.userId === u.id));

  const submit = (): void => {
    save.mutate(
      { confidentiality: dsp ? 'dsp' : 'normal', accessList: members.map((m) => m.userId) },
      {
        onSuccess: () => {
          toast({ title: t('access.savedToast'), tone: 'success' });
          setEditing(false);
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  const cancel = (): void => {
    setDsp(data.confidentiality === 'dsp');
    setMembers(data.members);
    setSearch('');
    setEditing(false);
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          {isDsp ? <Lock className="size-4 text-danger" /> : <ShieldCheck className="size-4" />}
          {t('access.title')}
          <span className="text-xs font-normal text-text-muted">
            {t(isDsp ? 'access.grifDsp' : 'access.grifNormal')}
          </span>
        </h2>
        {data.canManage && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t('access.manage')}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-text">
              <Lock className="size-4 text-text-muted" /> {t('access.markDsp')}
            </span>
            <Switch checked={dsp} onCheckedChange={setDsp} />
          </label>

          {dsp ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-muted">{t('access.allowList')}</span>
              <ul className="flex flex-col gap-1.5">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 text-[13px]">
                    <span className="text-text">{m.name ?? m.userId}</span>
                    <button
                      type="button"
                      className="ml-auto text-text-muted hover:text-danger"
                      onClick={() => setMembers((p) => p.filter((x) => x.userId !== m.userId))}
                      aria-label={t('access.remove')}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
                {members.length === 0 ? (
                  <li className="text-xs text-text-muted">{t('access.empty')}</li>
                ) : null}
              </ul>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('access.searchPeople')}
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
                          setMembers((prev) => [...prev, { userId: u.id, name: u.shortName }]);
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
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <MembersView isDsp={isDsp} members={data.members} />
      )}

      {isDsp && data.canManage ? <ReadLog documentId={doc.id} /> : null}
    </section>
  );
}

function MembersView({
  isDsp,
  members,
}: {
  isDsp: boolean;
  members: DocumentAccessMemberDto[];
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  if (!isDsp) return <p className="text-[13px] text-text-muted">{t('access.normalHint')}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-text-muted">{t('access.allowList')}</span>
      {members.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('access.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.userId} className="text-[13px] text-text">
              {m.name ?? m.userId}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadLog({ documentId }: { documentId: string }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const log = useDocumentReadLog(documentId, true);
  return (
    <div className={cn('mt-4 border-t border-border pt-3')}>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-muted">
        <Eye className="size-3.5" /> {t('access.readLog')}
      </h3>
      {log.isPending ? (
        <Skeleton className="h-8 w-full rounded-md" />
      ) : !log.data || log.data.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('access.readLogEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {log.data.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-[13px]">
              <span className="text-text">{e.actorName ?? e.actorId}</span>
              <span className="ml-auto text-xs text-text-muted">{formatDateTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
