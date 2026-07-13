import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AttachmentList, Badge, FileDropzone, type AttachmentItem } from '@cuks/ui';
import type { AvStatus, FsNodeDto } from '@cuks/shared';
import { formatBytes } from '@/lib/format';
import { useUploadManager, type ManagedUpload } from '../hooks/use-upload-manager';
import type { UploadTarget } from '../api/upload-file';

/**
 * Drop-in attachments field for module forms (documents, chat, tasks, ЧС —
 * docs/modules/12 §3): a dropzone plus a live list of uploads. Reports the set of
 * successfully-uploaded nodes through `onChange` so the host form can persist the
 * links. Composes the reusable {@link FileDropzone} + {@link AttachmentList} over
 * the shared {@link useUploadManager}. The first module consumer wires it to its
 * own attachment endpoint; until then it uploads to personal/org targets.
 */
export interface AttachmentFieldProps {
  target: UploadTarget;
  /** Fires whenever the set of completed nodes changes. */
  onChange?: (nodes: FsNodeDto[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
}

function avBadge(status: AvStatus | null | undefined, t: (k: string) => string): React.ReactNode {
  if (status === 'pending') return <Badge tone="warning">{t('av.pending')}</Badge>;
  if (status === 'infected') return <Badge tone="danger">{t('av.infected')}</Badge>;
  return null;
}

function toRow(it: ManagedUpload, t: (k: string) => string): AttachmentItem {
  return {
    id: it.id,
    name: it.name,
    mime: it.mime,
    status: it.status === 'done' || it.status === 'error' ? it.status : 'uploading',
    progress: it.size > 0 ? it.uploaded / it.size : 0,
    ...(it.error ? { error: it.error } : {}),
    subLabel: formatBytes(it.size),
    ...(it.node ? { meta: avBadge(it.node.avStatus, t) } : {}),
  };
}

export function AttachmentField({
  target,
  onChange,
  accept,
  multiple = true,
  disabled = false,
  className,
}: AttachmentFieldProps): React.JSX.Element {
  const { t } = useTranslation('uploads');
  const manager = useUploadManager(target);

  // Report completed nodes without re-firing on unrelated re-renders: key the
  // effect on the completed-node id set.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const nodeKey = manager.nodes.map((n) => n.id).join(',');
  useEffect(() => {
    onChangeRef.current?.(manager.nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodeKey encodes manager.nodes identity
  }, [nodeKey]);

  const download = (id: string): void => {
    const node = manager.items.find((it) => it.id === id)?.node;
    if (node) window.open(`/api/v1/files/${node.id}/download`, '_blank', 'noopener');
  };

  return (
    <div className={className}>
      <FileDropzone
        onFiles={manager.add}
        disabled={disabled}
        multiple={multiple}
        {...(accept ? { accept } : {})}
        label={t('dropzone.label')}
        hint={t('dropzone.hint')}
      />
      {manager.items.length > 0 ? (
        <AttachmentList
          className="mt-3"
          items={manager.items.map((it) => toRow(it, t))}
          onDownload={download}
          onRemove={manager.remove}
          labels={{
            download: t('actions.download'),
            remove: t('actions.remove'),
            uploading: t('uploading'),
          }}
        />
      ) : null}
    </div>
  );
}
