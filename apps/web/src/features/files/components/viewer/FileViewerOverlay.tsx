import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Download, ShieldAlert, X } from 'lucide-react';
import { Button } from '@cuks/ui';
import type { FsNodeDto } from '@cuks/shared';
import { downloadUrl } from '../../lib';
import { PdfViewer } from './PdfViewer';
import { AudioViewer, DownloadCard, ImageViewer, TextViewer, VideoViewer } from './viewers';

interface FileViewerOverlayProps {
  /** The current listing; the viewer steps through its FILE nodes with ←/→. */
  nodes: FsNodeDto[];
  node: FsNodeDto;
  onNavigate: (node: FsNodeDto) => void;
  onClose: () => void;
}

function pickViewer(node: FsNodeDto): React.JSX.Element {
  const mime = node.mime ?? '';
  if (node.avStatus === 'infected') return <BlockedViewer />;
  if (mime.startsWith('image/')) return <ImageViewer node={node} />;
  if (mime === 'application/pdf') return <PdfViewer node={node} />;
  if (mime.startsWith('video/')) return <VideoViewer node={node} />;
  if (mime.startsWith('audio/')) return <AudioViewer node={node} />;
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
    return <TextViewer node={node} />;
  }
  return <DownloadCard node={node} />;
}

function BlockedViewer(): React.JSX.Element {
  const { t } = useTranslation('files');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-white/70">
      <ShieldAlert className="size-12 text-danger" />
      <p className="text-[13px]">{t('viewer.infected')}</p>
    </div>
  );
}

export function FileViewerOverlay({
  nodes,
  node,
  onNavigate,
  onClose,
}: FileViewerOverlayProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const files = nodes.filter((n) => n.kind === 'file');
  const index = files.findIndex((n) => n.id === node.id);
  const prev = index > 0 ? files[index - 1] : null;
  const next = index >= 0 && index < files.length - 1 ? files[index + 1] : null;

  // Media players own ←/→ for seeking, and the PDF viewer owns ↑/↓/PageUp-Down
  // for pages — only steal ←/→ for file navigation for the other viewers.
  const mime = node.mime ?? '';
  const isMedia = mime.startsWith('video/') || mime.startsWith('audio/');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (isMedia) return;
      else if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault();
        onNavigate(prev);
      } else if (e.key === 'ArrowRight' && next) {
        e.preventDefault();
        onNavigate(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, onNavigate, isMedia]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="min-w-0 truncate text-[13px] font-medium text-white">{node.name}</span>
        <div className="flex items-center gap-1">
          <a
            href={downloadUrl(node.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('row.download')}
          >
            <Button variant="ghost" size="icon" className="size-8 text-white hover:bg-white/10">
              <Download className="size-4" />
            </Button>
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white hover:bg-white/10"
            aria-label={t('viewer.close')}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Body with side nav arrows */}
      <div className="relative min-h-0 flex-1">
        {prev ? (
          <button
            type="button"
            onClick={() => onNavigate(prev)}
            aria-label={t('viewer.prev')}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/60 hover:text-white"
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : null}
        {next ? (
          <button
            type="button"
            onClick={() => onNavigate(next)}
            aria-label={t('viewer.next')}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/60 hover:text-white"
          >
            <ChevronRight className="size-6" />
          </button>
        ) : null}
        {/* key forces each viewer to fully remount when the file changes */}
        <div key={node.id} className="h-full">
          {pickViewer(node)}
        </div>
      </div>
    </div>
  );
}
