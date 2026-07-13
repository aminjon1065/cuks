import { AlertCircle, Download, Loader2, X } from 'lucide-react';
import { Button } from './button';
import { fileIcon } from '../lib/file-icon';
import { cn } from '../lib/cn';

export type AttachmentStatus = 'uploading' | 'done' | 'error';

/**
 * One row of {@link AttachmentList}. Presentational — the consumer owns the
 * upload/link state and formats locale-dependent bits (`subLabel`, `meta`).
 */
export interface AttachmentItem {
  id: string;
  name: string;
  /** Used only to pick the type icon for finished items. */
  mime?: string | null;
  status: AttachmentStatus;
  /** 0..1, shown as a bar while `status === 'uploading'`. */
  progress?: number;
  /** Error text shown when `status === 'error'` (replaces `subLabel`). */
  error?: string;
  /** Right-aligned secondary content: percent, AV badge, etc. */
  meta?: React.ReactNode;
  /** Secondary line under the name: formatted size, etc. */
  subLabel?: React.ReactNode;
}

export interface AttachmentListProps {
  items: AttachmentItem[];
  /** Row activation (e.g. open preview). Omitting it leaves rows non-interactive. */
  onOpen?: (id: string) => void;
  onDownload?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** aria-labels for the icon actions and the progress bar (i18n by consumer). */
  labels?: { download?: string; remove?: string; uploading?: string };
  /** Tighter rows without borders (progress dock) vs. bordered card rows (form field). */
  variant?: 'card' | 'plain';
  className?: string;
}

function StatusIcon({ item }: { item: AttachmentItem }): React.JSX.Element {
  // Decorative — the row's name (and, while uploading, the progressbar) carry the
  // accessible meaning; hide the icon from assistive tech to avoid noise.
  if (item.status === 'done') {
    const Icon = fileIcon(item.mime);
    return <Icon aria-hidden className="size-4 shrink-0 text-text-muted" />;
  }
  if (item.status === 'error') {
    return <AlertCircle aria-hidden className="size-4 shrink-0 text-danger" />;
  }
  return <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-text-muted" />;
}

/**
 * Reusable list of file attachments with upload progress and per-row actions
 * (docs/modules/12 §4). Drives the global upload dock and module attachment
 * fields alike. Purely presentational — no data fetching, no i18n.
 */
export function AttachmentList({
  items,
  onOpen,
  onDownload,
  onRemove,
  labels,
  variant = 'card',
  className,
}: AttachmentListProps): React.JSX.Element {
  return (
    <ul
      className={cn(
        variant === 'card' && 'overflow-hidden rounded-lg border border-border bg-surface',
        className,
      )}
    >
      {items.map((it) => {
        const pct =
          it.status === 'uploading' && typeof it.progress === 'number'
            ? Math.round(Math.min(1, Math.max(0, it.progress)) * 100)
            : 0;
        const clickable = !!onOpen && it.status === 'done';
        return (
          <li
            key={it.id}
            className={cn(
              'group flex items-center gap-2.5 px-3 py-2',
              variant === 'card' && 'border-b border-border last:border-b-0',
            )}
          >
            <StatusIcon item={it} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onOpen(it.id)}
                    className="min-w-0 truncate text-left text-[13px] font-medium text-text hover:text-primary"
                  >
                    {it.name}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-[13px] font-medium text-text">
                    {it.name}
                  </span>
                )}
                {it.meta ? (
                  <span className="ml-auto shrink-0 text-xs text-text-muted">{it.meta}</span>
                ) : null}
              </div>
              {it.status === 'uploading' ? (
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  {...(labels?.uploading ? { 'aria-label': labels.uploading } : {})}
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2"
                >
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : it.status === 'error' ? (
                <p className="mt-0.5 truncate text-xs text-danger">{it.error}</p>
              ) : it.subLabel ? (
                <p className="mt-0.5 truncate text-xs text-text-muted">{it.subLabel}</p>
              ) : null}
            </div>
            {onDownload && it.status === 'done' ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={labels?.download}
                onClick={() => onDownload(it.id)}
              >
                <Download className="size-3.5" />
              </Button>
            ) : null}
            {onRemove ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={labels?.remove}
                onClick={() => onRemove(it.id)}
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
