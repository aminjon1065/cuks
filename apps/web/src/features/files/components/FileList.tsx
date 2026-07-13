import { useTranslation } from 'react-i18next';
import {
  Download,
  MoreHorizontal,
  Share2,
  FolderInput,
  Pencil,
  History,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@cuks/ui';
import type { FsNodeDto } from '@cuks/shared';
import { formatBytes, formatDateTime, isImage, nodeIcon } from '../lib';

export interface FileRowActions {
  onOpen: (node: FsNodeDto) => void;
  onDownload: (node: FsNodeDto) => void;
  onShare: (node: FsNodeDto) => void;
  onMove: (node: FsNodeDto) => void;
  onRename: (node: FsNodeDto) => void;
  onVersions: (node: FsNodeDto) => void;
  onTrash: (node: FsNodeDto) => void;
}

interface FileListProps {
  nodes: FsNodeDto[];
  view: 'table' | 'grid';
  selectedId: string | null;
  onSelect: (node: FsNodeDto) => void;
  actions: FileRowActions;
  /** Read-only listings (shared/trash) hide the mutating row menu. */
  readOnly?: boolean;
}

function previewUrl(node: FsNodeDto): string {
  return `/api/v1/files/${node.id}/preview?size=small`;
}

export function FileList({
  nodes,
  view,
  selectedId,
  onSelect,
  actions,
  readOnly = false,
}: FileListProps): React.JSX.Element {
  const { t } = useTranslation('files');

  const RowMenu = ({ node }: { node: FsNodeDto }): React.JSX.Element => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('row.moreActions')}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {node.kind === 'file' ? (
          <DropdownMenuItem onSelect={() => actions.onDownload(node)}>
            <Download className="size-4" /> {t('row.download')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => actions.onShare(node)}>
          <Share2 className="size-4" /> {t('row.share')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onMove(node)}>
          <FolderInput className="size-4" /> {t('row.move')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onRename(node)}>
          <Pencil className="size-4" /> {t('row.rename')}
        </DropdownMenuItem>
        {node.kind === 'file' ? (
          <DropdownMenuItem onSelect={() => actions.onVersions(node)}>
            <History className="size-4" /> {t('row.versions')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.onTrash(node)} className="text-danger">
          <Trash2 className="size-4" /> {t('row.trash')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (view === 'grid') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {nodes.map((node) => {
          const Icon = nodeIcon(node);
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node)}
              onDoubleClick={() => actions.onOpen(node)}
              className={`group flex flex-col overflow-hidden rounded-lg border bg-surface text-left transition-colors hover:border-primary/40 ${
                selectedId === node.id ? 'border-primary ring-1 ring-primary/30' : 'border-border'
              }`}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-surface-2">
                {isImage(node) ? (
                  <img
                    src={previewUrl(node)}
                    alt={node.name}
                    loading="lazy"
                    className="size-full object-cover"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                ) : (
                  <Icon className="size-9 text-text-muted" />
                )}
              </div>
              <div className="flex items-center gap-2 px-2.5 py-2">
                <Icon className="size-4 shrink-0 text-text-muted" />
                <span className="truncate text-[13px] font-medium text-text">{node.name}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t('columns.name')}</TableHead>
            <TableHead className="w-28">{t('columns.size')}</TableHead>
            <TableHead className="w-40">{t('columns.modified')}</TableHead>
            {readOnly ? null : <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((node) => {
            const Icon = nodeIcon(node);
            return (
              <TableRow
                key={node.id}
                onClick={() => onSelect(node)}
                onDoubleClick={() => actions.onOpen(node)}
                className={`cursor-pointer ${selectedId === node.id ? 'bg-surface-2' : ''}`}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-text-muted" />
                    <span className="truncate text-[13px] font-medium text-text">{node.name}</span>
                    {node.kind === 'file' && node.avStatus === 'pending' ? (
                      <Badge tone="warning">{t('inspector.scan.pending')}</Badge>
                    ) : null}
                    {node.kind === 'file' && node.avStatus === 'infected' ? (
                      <Badge tone="danger">{t('inspector.scan.infected')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-text-muted">
                  {node.kind === 'file' ? formatBytes(node.sizeCached) : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-text-muted">
                  {formatDateTime(node.updatedAt)}
                </TableCell>
                {readOnly ? null : (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <RowMenu node={node} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
