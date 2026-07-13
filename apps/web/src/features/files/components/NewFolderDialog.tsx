import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useCreateFolder, type FsSpaceParam } from '../api/queries';

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: FsSpaceParam;
  parentId: string | null;
  orgUnitId?: string | undefined;
}

export function NewFolderDialog({
  open,
  onOpenChange,
  space,
  parentId,
  orgUnitId,
}: NewFolderDialogProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const [name, setName] = useState('');
  const create = useCreateFolder();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      {
        space,
        name: trimmed,
        ...(parentId ? { parentId } : {}),
        ...(orgUnitId ? { orgUnitId } : {}),
      },
      {
        onSuccess: () => {
          setName('');
          onOpenChange(false);
        },
        onError: (err) =>
          toast({
            title: t('newFolder.title'),
            description: err instanceof ApiError ? err.message : String(err),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newFolder.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">{t('newFolder.nameLabel')}</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newFolder.namePlaceholder')}
              maxLength={255}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? t('newFolder.creating') : t('newFolder.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
