import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Badge, Button } from '@cuks/ui';
import type { FsNodeDto } from '@cuks/shared';
import { formatBytes, formatDateTime, nodeIcon } from '../lib';

/** A row item for search/recent — an fs node, optionally with a location breadcrumb. */
export type ResultItem = FsNodeDto & { location?: string | null };

interface ResultListProps {
  items: ResultItem[];
  onOpen: (node: FsNodeDto) => void;
  onDownload: (node: FsNodeDto) => void;
  /** Show the ancestor-folder location under the name (search results). */
  showLocation?: boolean;
}

/**
 * Flat list of files for the search and "Recent" views (docs/modules/12 §2, §6):
 * discovery-focused — open (quick-view) and download only, no move/rename menu
 * (those belong in the file's own folder, where the space context is known).
 */
export function ResultList({
  items,
  onOpen,
  onDownload,
  showLocation = false,
}: ResultListProps): React.JSX.Element {
  const { t } = useTranslation('files');
  return (
    <div
      data-testid="files-results"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      {items.map((node) => {
        const Icon = nodeIcon(node);
        return (
          <div
            key={node.id}
            onDoubleClick={() => onOpen(node)}
            className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2"
          >
            <Icon className="size-4 shrink-0 text-text-muted" />
            <button type="button" onClick={() => onOpen(node)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-text">{node.name}</span>
                {node.avStatus === 'pending' ? (
                  <Badge tone="warning">{t('inspector.scan.pending')}</Badge>
                ) : node.avStatus === 'infected' ? (
                  <Badge tone="danger">{t('inspector.scan.infected')}</Badge>
                ) : null}
              </div>
              {showLocation && node.location ? (
                <span className="block truncate text-xs text-text-muted">{node.location}</span>
              ) : null}
            </button>
            <span className="shrink-0 text-xs text-text-muted">{formatBytes(node.sizeCached)}</span>
            <span className="hidden shrink-0 whitespace-nowrap text-xs text-text-muted sm:block">
              {formatDateTime(node.updatedAt)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('row.download')}
              onClick={(e) => {
                e.stopPropagation();
                onDownload(node);
              }}
            >
              <Download className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
