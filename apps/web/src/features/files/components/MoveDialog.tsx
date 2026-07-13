import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Folder, Home, Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@cuks/ui';
import type { BreadcrumbDto, FsNodeDto } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { usePatchNode, useTree, type FsSpaceParam } from '../api/queries';

interface MoveDialogProps {
  node: FsNodeDto | null;
  space: FsSpaceParam;
  orgUnitId?: string | undefined;
  onClose: () => void;
}

export function MoveDialog({
  node,
  space,
  orgUnitId,
  onClose,
}: MoveDialogProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const [destId, setDestId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<BreadcrumbDto[]>([]);
  const patch = usePatchNode();

  const tree = useTree({ space, parentId: destId, ...(orgUnitId ? { orgUnitId } : {}) }, !!node);

  const folders = (tree.data?.items ?? []).filter((n) => n.kind === 'folder' && n.id !== node?.id);
  const alreadyHere = node?.parentId === destId;

  const drillInto = (folder: FsNodeDto): void => {
    setDestId(folder.id);
    setCrumbs((c) => [...c, { id: folder.id, name: folder.name }]);
  };

  const jumpTo = (index: number): void => {
    if (index < 0) {
      setDestId(null);
      setCrumbs([]);
    } else {
      setDestId(crumbs[index]!.id);
      setCrumbs(crumbs.slice(0, index + 1));
    }
  };

  const submit = (): void => {
    if (!node || alreadyHere) return;
    patch.mutate(
      { id: node.id, input: { parentId: destId } },
      {
        onSuccess: onClose,
        onError: (err) =>
          toast({
            title: t('moveDialog.title', { name: node.name }),
            description: err instanceof ApiError ? err.message : String(err),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <Dialog open={!!node} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('moveDialog.title', { name: node?.name ?? '' })}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1 text-[13px] text-text-muted">
          <button type="button" onClick={() => jumpTo(-1)} className="hover:text-text">
            <Home className="size-4" />
          </button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              <button type="button" onClick={() => jumpTo(i)} className="truncate hover:text-text">
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div className="h-56 overflow-y-auto rounded-md border border-border">
          {tree.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-text-muted" />
            </div>
          ) : folders.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-text-muted">—</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => drillInto(f)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-surface-2"
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="size-4 text-text-muted" /> {f.name}
                </span>
                <ChevronRight className="size-4 text-text-muted" />
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={alreadyHere || patch.isPending}>
            {patch.isPending
              ? t('moveDialog.moving')
              : alreadyHere
                ? t('moveDialog.sameParent')
                : t('moveDialog.moveHere')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
