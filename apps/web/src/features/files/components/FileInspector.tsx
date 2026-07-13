import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RotateCcw, Share2 } from 'lucide-react';
import { Badge, Button, SidePanel, Skeleton, toast } from '@cuks/ui';
import type { FsNodeDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useRestoreVersion, useVersions } from '../api/queries';
import { formatBytes, formatDateTime, isImage, nodeIcon } from '../lib';

type Tab = 'details' | 'versions' | 'access' | 'activity';

interface FileInspectorProps {
  node: FsNodeDto | null;
  onClose: () => void;
  onDownload: (node: FsNodeDto) => void;
  onShare: (node: FsNodeDto) => void;
}

const TABS: Tab[] = ['details', 'versions', 'access', 'activity'];

export function FileInspector({
  node,
  onClose,
  onDownload,
  onShare,
}: FileInspectorProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const [tab, setTab] = useState<Tab>('details');
  const isFile = node?.kind === 'file';
  const versions = useVersions(tab === 'versions' && isFile ? (node?.id ?? null) : null);
  const restore = useRestoreVersion();
  const Icon = node ? nodeIcon(node) : null;

  const restoreVersion = (version: number): void => {
    if (!node) return;
    restore.mutate(
      { id: node.id, version },
      {
        onSuccess: () => toast({ title: t('versions.restored'), tone: 'success' }),
        onError: (err) =>
          toast({
            title: t('versions.title'),
            description: err instanceof ApiError ? err.message : String(err),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <SidePanel
      open={!!node}
      onOpenChange={(o) => !o && onClose()}
      modal={false}
      title={
        node ? (
          <span className="flex items-center gap-2">
            {Icon ? <Icon className="size-4 text-text-muted" /> : null}
            <span className="truncate">{node.name}</span>
          </span>
        ) : null
      }
    >
      {!node ? null : (
        <div className="space-y-4">
          {/* Actions */}
          <div className="flex gap-2">
            {isFile ? (
              <Button variant="outline" size="sm" onClick={() => onDownload(node)}>
                <Download className="size-4" /> {t('row.download')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onShare(node)}>
              <Share2 className="size-4" /> {t('row.share')}
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border">
            {TABS.map((tb) => (
              <button
                key={tb}
                type="button"
                onClick={() => setTab(tb)}
                className={`-mb-px border-b-2 px-2.5 py-1.5 text-[13px] transition-colors ${
                  tab === tb
                    ? 'border-primary font-medium text-text'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {t(`inspector.tabs.${tb}`)}
              </button>
            ))}
          </div>

          {tab === 'details' ? (
            <div className="space-y-4">
              {isImage(node) ? (
                <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
                  <img
                    src={`/api/v1/files/${node.id}/preview?size=medium`}
                    alt={t('inspector.previewAlt')}
                    className="max-h-56 w-full object-contain"
                    onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
                  />
                </div>
              ) : null}
              <dl className="space-y-2 text-[13px]">
                <Meta label={t('inspector.meta.type')} value={node.mime ?? t('folder')} />
                {isFile ? (
                  <Meta label={t('inspector.meta.size')} value={formatBytes(node.sizeCached)} />
                ) : null}
                <Meta label={t('inspector.meta.created')} value={formatDateTime(node.createdAt)} />
                <Meta label={t('inspector.meta.modified')} value={formatDateTime(node.updatedAt)} />
                {isFile ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-text-muted">{t('inspector.meta.scan')}</dt>
                    <dd>
                      <Badge
                        tone={
                          node.avStatus === 'clean'
                            ? 'success'
                            : node.avStatus === 'infected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {t(`inspector.scan.${node.avStatus ?? 'pending'}`)}
                      </Badge>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {tab === 'versions' ? (
            !isFile ? (
              <p className="text-[13px] text-text-muted">{t('versions.empty')}</p>
            ) : versions.isLoading ? (
              <Skeleton className="h-32 w-full rounded-md" />
            ) : (versions.data ?? []).length === 0 ? (
              <p className="text-[13px] text-text-muted">{t('versions.empty')}</p>
            ) : (
              <ul className="space-y-1">
                {(versions.data ?? []).map((v, i) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[13px]">
                        {t('versions.version', { n: v.version })}
                        {i === 0 ? <Badge tone="primary">{t('versions.current')}</Badge> : null}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatBytes(v.size)} · {formatDateTime(v.createdAt)}
                      </div>
                    </div>
                    {i !== 0 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t('versions.restore')}
                        disabled={restore.isPending}
                        onClick={() => restoreVersion(v.version)}
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {tab === 'access' ? (
            <div className="space-y-3">
              <p className="text-[13px] text-text-muted">{t('share.link.hint')}</p>
              <Button variant="outline" size="sm" onClick={() => onShare(node)}>
                <Share2 className="size-4" /> {t('row.share')}
              </Button>
            </div>
          ) : null}

          {tab === 'activity' ? (
            <p className="text-[13px] text-text-muted">{t('inspector.activity.empty')}</p>
          ) : null}
        </div>
      )}
    </SidePanel>
  );
}

function Meta({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd className="truncate text-right text-text">{value}</dd>
    </div>
  );
}
