import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  Clock,
  FolderClosed,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  Search,
  Share2,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FileDropzone,
  Input,
  Label,
  PageHeader,
  Skeleton,
  toast,
} from '@cuks/ui';
import type { BreadcrumbDto, FsNodeDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { useMe } from '@/features/auth/api/queries';
import {
  filesKey,
  usePatchNode,
  useQuota,
  useRecent,
  useRestoreNode,
  useSearch,
  useSharedWithMe,
  useTrash,
  useTrashNode,
  useTree,
  type FsSpaceParam,
} from '../api/queries';
import { useUploadStore, UploadDock } from '@/features/uploads';
import { formatBytes } from '../lib';
import { FileList } from '../components/FileList';
import { ResultList } from '../components/ResultList';
import { FileInspector } from '../components/FileInspector';
import { NewFolderDialog } from '../components/NewFolderDialog';
import { MoveDialog } from '../components/MoveDialog';
import { ShareDialog } from '../components/ShareDialog';
import { FileViewerOverlay } from '../components/viewer/FileViewerOverlay';

type Section = 'personal' | 'org' | 'shared' | 'recent' | 'trash';
const SECTIONS: { key: Section; icon: typeof FolderClosed }[] = [
  { key: 'personal', icon: FolderClosed },
  { key: 'org', icon: Users },
  { key: 'shared', icon: Share2 },
  { key: 'recent', icon: Clock },
  { key: 'trash', icon: Trash2 },
];

/** Debounce a rapidly-changing value (search box → query). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const VIEW_KEY = 'cuks-files-view';

export function FilesPage(): React.JSX.Element {
  const { t } = useTranslation('files');
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const section = (params.get('section') as Section) || 'personal';
  const folderId = params.get('folder');
  const orgUnits = me.data?.orgContext ?? [];
  const unitParam = params.get('unit') ?? orgUnits[0]?.orgUnitId;

  const [view, setView] = useState<'table' | 'grid'>(
    () => (localStorage.getItem(VIEW_KEY) as 'table' | 'grid') || 'table',
  );
  const [selected, setSelected] = useState<FsNodeDto | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moveNode, setMoveNode] = useState<FsNodeDto | null>(null);
  const [shareNode, setShareNode] = useState<FsNodeDto | null>(null);
  const [renameNode, setRenameNode] = useState<FsNodeDto | null>(null);
  const [trashTarget, setTrashTarget] = useState<FsNodeDto | null>(null);
  const [viewerNode, setViewerNode] = useState<FsNodeDto | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // `searching` follows the immediate input (not the debounced value) so clicking a
  // rail section exits search at once — no ~300ms window of stale results. The
  // request itself still uses the debounced `q`.
  const q = useDebouncedValue(searchInput.trim(), 300);
  const searching = searchInput.trim().length > 0;

  const isBrowse = !searching && (section === 'personal' || section === 'org');
  const space: FsSpaceParam = section === 'org' ? 'org' : 'personal';

  const tree = useTree(
    { space, parentId: folderId, ...(unitParam ? { orgUnitId: unitParam } : {}) },
    isBrowse && (section !== 'org' || !!unitParam),
  );
  const shared = useSharedWithMe(!searching && section === 'shared');
  const recent = useRecent(!searching && section === 'recent');
  const trash = useTrash('personal', undefined, !searching && section === 'trash');
  const search = useSearch(q, searching);
  const quota = useQuota(space, section === 'org' ? unitParam : undefined);

  // Debounce still catching up to the input, or the request is in flight — show a
  // skeleton rather than flashing "nothing found" while the first hits load.
  const searchPending = searching && (q !== searchInput.trim() || search.isFetching);

  const patch = usePatchNode();
  const trashNode = useTrashNode();
  const restoreNode = useRestoreNode();
  const enqueue = useUploadStore((s) => s.enqueue);
  const qc = useQueryClient();

  const setView2 = (v: 'table' | 'grid'): void => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const go = (next: { section?: Section; folder?: string | null; unit?: string }): void => {
    const p = new URLSearchParams(params);
    if (next.section) p.set('section', next.section);
    if (next.unit) p.set('unit', next.unit);
    if (next.folder === null) p.delete('folder');
    else if (next.folder) p.set('folder', next.folder);
    setParams(p);
    setSelected(null);
    setSearchInput(''); // navigating exits search mode
  };

  const nodes: FsNodeDto[] = searching
    ? (search.data ?? [])
    : section === 'shared'
      ? (shared.data ?? [])
      : section === 'recent'
        ? (recent.data ?? [])
        : section === 'trash'
          ? (trash.data ?? [])
          : (tree.data?.items ?? []);
  const breadcrumbs: BreadcrumbDto[] = isBrowse ? (tree.data?.breadcrumbs ?? []) : [];
  const activeQuery =
    section === 'shared'
      ? shared
      : section === 'recent'
        ? recent
        : section === 'trash'
          ? trash
          : tree;

  const download = (node: FsNodeDto): void => {
    window.open(`/api/v1/files/${node.id}/download`, '_blank', 'noopener');
  };
  // Double-click / Enter: folders navigate in, files open the quick-view overlay
  // (docs/modules/12 §5). Explicit download stays available in the row menu/inspector.
  const open = (node: FsNodeDto): void => {
    if (node.kind === 'folder') go({ folder: node.id });
    else {
      // Close the peek inspector the first click opened, so a single Esc closes
      // just the viewer (not both layers).
      setSelected(null);
      setViewerNode(node);
    }
  };

  const startUpload = (files: File[]): void => {
    if (files.length === 0 || !isBrowse) return;
    enqueue(
      files,
      {
        space,
        parentId: folderId,
        ...(unitParam && space === 'org' ? { orgUnitId: unitParam } : {}),
      },
      // Invalidate the whole files slice so the listing AND the quota bar refresh.
      () => void qc.invalidateQueries({ queryKey: filesKey }),
    );
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    if (isBrowse) startUpload([...e.dataTransfer.files]);
  };

  const doRename = (name: string): void => {
    if (!renameNode) return;
    patch.mutate(
      { id: renameNode.id, input: { name } },
      {
        onSuccess: () => setRenameNode(null),
        onError: (err) =>
          toast({
            title: t('row.rename'),
            description: err instanceof ApiError ? err.message : String(err),
            tone: 'danger',
          }),
      },
    );
  };

  const actions = {
    onOpen: open,
    onDownload: download,
    onShare: setShareNode,
    onMove: setMoveNode,
    onRename: setRenameNode,
    onVersions: (n: FsNodeDto) => setSelected(n),
    onTrash: setTrashTarget,
  };

  return (
    <div className="flex gap-5">
      {/* Sections rail */}
      <aside className="w-48 shrink-0 space-y-1">
        {SECTIONS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => go({ section: key, folder: null })}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
              section === key
                ? 'bg-surface-2 font-medium text-text'
                : 'text-text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            <Icon className="size-4" /> {t(`sections.${key}`)}
          </button>
        ))}

        {(section === 'personal' || section === 'org') && quota.data ? (
          <div className="!mt-4 rounded-md border border-border p-3">
            <div className="mb-1.5 flex justify-between text-xs text-text-muted">
              <span>{t('quota.label')}</span>
              <span>
                {formatBytes(quota.data.usedBytes)}
                {quota.data.quotaBytes !== null ? ` / ${formatBytes(quota.data.quotaBytes)}` : ''}
              </span>
            </div>
            {quota.data.quotaBytes !== null ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-primary"
                  style={{
                    width: `${Math.min(100, Math.round((quota.data.usedBytes / quota.data.quotaBytes) * 100))}%`,
                  }}
                />
              </div>
            ) : (
              <div className="text-xs text-text-muted">{t('quota.unlimited')}</div>
            )}
          </div>
        ) : null}
      </aside>

      {/* Main */}
      <div
        className="min-w-0 flex-1 space-y-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <PageHeader
          title={t('title')}
          description={t('subtitle')}
          actions={
            <div className="flex items-center gap-2">
              <div className="relative w-52">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.placeholder')}
                  className="h-8 pl-8 pr-8 text-[13px]"
                  data-testid="files-search"
                />
                {searchInput ? (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    aria-label={t('search.clear')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              {isBrowse ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNewFolderOpen(true)}
                    data-testid="files-new-folder"
                  >
                    <FolderPlus className="size-4" /> {t('toolbar.newFolder')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="files-upload"
                  >
                    <Upload className="size-4" /> {t('toolbar.upload')}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    data-testid="files-file-input"
                    onChange={(e) => {
                      startUpload([...(e.target.files ?? [])]);
                      e.target.value = '';
                    }}
                  />
                </>
              ) : null}
            </div>
          }
        />

        {/* Breadcrumbs + view toggle */}
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1 text-[13px] text-text-muted">
            {searching ? (
              <span className="font-medium text-text">{t('search.title', { q })}</span>
            ) : isBrowse ? (
              <>
                <button
                  type="button"
                  onClick={() => go({ folder: null })}
                  className="hover:text-text"
                >
                  <Home className="size-4" />
                </button>
                {breadcrumbs.map((c) => (
                  <span key={c.id} className="flex items-center gap-1">
                    <ChevronRight className="size-3.5" />
                    <button
                      type="button"
                      onClick={() => go({ folder: c.id })}
                      className="truncate hover:text-text"
                    >
                      {c.name}
                    </button>
                  </span>
                ))}
              </>
            ) : (
              <span className="font-medium text-text">{t(`sections.${section}`)}</span>
            )}
          </div>
          {!searching && (section === 'personal' || section === 'org' || section === 'shared') ? (
            <div className="flex items-center gap-1">
              <Button
                variant={view === 'table' ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8"
                aria-label={t('toolbar.viewTable')}
                onClick={() => setView2('table')}
              >
                <List className="size-4" />
              </Button>
              <Button
                variant={view === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8"
                aria-label={t('toolbar.viewGrid')}
                onClick={() => setView2('grid')}
              >
                <LayoutGrid className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>

        {!searching && section === 'trash' ? (
          <p className="text-xs text-text-muted">{t('trash.hint')}</p>
        ) : null}

        {/* Content */}
        {searching ? (
          search.isError ? (
            <ErrorState forbidden={false} onRetry={() => void search.refetch()} />
          ) : (search.data ?? []).length === 0 ? (
            searchPending ? (
              <Skeleton className="h-80 w-full rounded-lg" />
            ) : (
              <EmptyState
                icon={Search}
                title={t('search.empty.title')}
                description={t('search.empty.description')}
              />
            )
          ) : (
            <ResultList
              items={search.data ?? []}
              showLocation
              onOpen={open}
              onDownload={download}
            />
          )
        ) : activeQuery.isLoading ? (
          <Skeleton className="h-80 w-full rounded-lg" />
        ) : activeQuery.isError ? (
          <ErrorState
            forbidden={activeQuery.error instanceof ApiError && activeQuery.error.status === 403}
            onRetry={() => void activeQuery.refetch()}
          />
        ) : nodes.length === 0 ? (
          isBrowse ? (
            <FileDropzone
              onFiles={startUpload}
              label={t('dropzone.label')}
              hint={t('dropzone.hint')}
              className="py-16"
              data-testid="files-empty-dropzone"
            />
          ) : (
            <FilesEmpty section={section} />
          )
        ) : section === 'recent' ? (
          <ResultList items={recent.data ?? []} onOpen={open} onDownload={download} />
        ) : section === 'trash' ? (
          <TrashList
            nodes={nodes}
            onRestore={(n) =>
              restoreNode.mutate(n.id, {
                onError: (err) =>
                  toast({
                    title: t('trash.restore'),
                    description: err instanceof ApiError ? err.message : String(err),
                    tone: 'danger',
                  }),
              })
            }
          />
        ) : (
          <FileList
            nodes={nodes}
            view={view}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            actions={actions}
            readOnly={section === 'shared'}
          />
        )}
      </div>

      {/* Inspector + dialogs */}
      <FileInspector
        node={selected}
        onClose={() => setSelected(null)}
        onDownload={download}
        onShare={setShareNode}
      />
      {isBrowse ? (
        <NewFolderDialog
          open={newFolderOpen}
          onOpenChange={setNewFolderOpen}
          space={space}
          parentId={folderId}
          orgUnitId={space === 'org' ? unitParam : undefined}
        />
      ) : null}
      {/* key remounts each open so drill-down / level state never leaks across nodes */}
      {moveNode ? (
        <MoveDialog
          key={moveNode.id}
          node={moveNode}
          space={space}
          orgUnitId={space === 'org' ? unitParam : undefined}
          onClose={() => setMoveNode(null)}
        />
      ) : null}
      {shareNode ? (
        <ShareDialog key={shareNode.id} node={shareNode} onClose={() => setShareNode(null)} />
      ) : null}
      {renameNode ? (
        <RenameDialog
          key={renameNode.id}
          node={renameNode}
          onClose={() => setRenameNode(null)}
          onSubmit={doRename}
          pending={patch.isPending}
        />
      ) : null}
      <ConfirmDialog
        open={!!trashTarget}
        onOpenChange={(o) => !o && setTrashTarget(null)}
        title={t('confirm.trashTitle')}
        description={t('confirm.trashBody', { name: trashTarget?.name ?? '' })}
        entityName={trashTarget?.name}
        confirmLabel={t('confirm.trash')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        loading={trashNode.isPending}
        onConfirm={() => {
          if (!trashTarget) return;
          trashNode.mutate(trashTarget.id, {
            onSuccess: () => {
              setTrashTarget(null);
              if (selected?.id === trashTarget.id) setSelected(null);
            },
            onError: (err) =>
              toast({
                title: t('confirm.trash'),
                description: err instanceof ApiError ? err.message : String(err),
                tone: 'danger',
              }),
          });
        }}
      />
      <UploadDock />
      {viewerNode ? (
        <FileViewerOverlay
          nodes={nodes}
          node={viewerNode}
          onNavigate={setViewerNode}
          onClose={() => setViewerNode(null)}
        />
      ) : null}
    </div>
  );
}

function ErrorState({
  forbidden,
  onRetry,
}: {
  forbidden: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('files');
  if (forbidden) {
    return (
      <EmptyState
        icon={Share2}
        title={t('forbidden.title')}
        description={t('forbidden.description')}
      />
    );
  }
  return (
    <div className="rounded-lg border border-border py-10 text-center text-[13px] text-text-muted">
      <p>{t('loadError')}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}

function FilesEmpty({ section }: { section: Section }): React.JSX.Element {
  const { t } = useTranslation('files');
  const map = {
    personal: { title: t('empty.title'), description: t('empty.description') },
    org: { title: t('empty.org.title'), description: t('empty.org.description') },
    shared: { title: t('empty.shared.title'), description: t('empty.shared.description') },
    recent: { title: t('empty.recent.title'), description: t('empty.recent.description') },
    trash: { title: t('trash.empty.title'), description: t('trash.empty.description') },
  }[section];
  return <EmptyState icon={FolderClosed} title={map.title} description={map.description} />;
}

function TrashList({
  nodes,
  onRestore,
}: {
  nodes: FsNodeDto[];
  onRestore: (n: FsNodeDto) => void;
}): React.JSX.Element {
  const { t } = useTranslation('files');
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {nodes.map((n) => (
        <div
          key={n.id}
          className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0"
        >
          <span className="truncate text-[13px] text-text">{n.name}</span>
          <Button variant="outline" size="sm" onClick={() => onRestore(n)}>
            {t('trash.restore')}
          </Button>
        </div>
      ))}
    </div>
  );
}

function RenameDialog({
  node,
  onClose,
  onSubmit,
  pending,
}: {
  node: FsNodeDto | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('files');
  const [name, setName] = useState(node?.name ?? '');
  return (
    <Dialog open={!!node} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('row.rename')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="rename-input">{t('newFolder.nameLabel')}</Label>
            <Input
              id="rename-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || pending}>
              {t('row.rename')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
