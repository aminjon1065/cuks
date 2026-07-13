import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileWarning, Loader2 } from 'lucide-react';
import { Button } from '@cuks/ui';
import type { FsNodeDto } from '@cuks/shared';
import { downloadUrl, nodeIcon } from '../../lib';

export function ImageViewer({ node }: { node: FsNodeDto }): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      {!loaded && !failed ? (
        <Loader2 className="absolute size-8 animate-spin text-white/70" />
      ) : null}
      {failed ? (
        <ViewerError />
      ) : (
        <img
          src={downloadUrl(node.id)}
          alt={node.name}
          className="max-h-full max-w-full object-contain"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function VideoViewer({ node }: { node: FsNodeDto }): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <video src={downloadUrl(node.id)} controls autoPlay className="max-h-full max-w-full" />
    </div>
  );
}

export function AudioViewer({ node }: { node: FsNodeDto }): React.JSX.Element {
  const Icon = nodeIcon(node);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-4">
      <Icon className="size-16 text-white/40" />
      <audio src={downloadUrl(node.id)} controls autoPlay className="w-full max-w-md" />
    </div>
  );
}

const TEXT_LIMIT = 512 * 1024; // don't render more than 512 KiB of text inline

export function TextViewer({ node }: { node: FsNodeDto }): React.JSX.Element {
  const { t } = useTranslation('files');
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setError(false);
    // Request only the first TEXT_LIMIT bytes (MinIO honours Range → 206) so a
    // huge .log/.json upload can't buffer its whole body into the tab; the DOM
    // cap alone wouldn't help since Response.text() reads to completion.
    fetch(downloadUrl(node.id), {
      credentials: 'include',
      headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` },
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        const range = r.headers.get('Content-Range'); // "bytes 0-524287/<total>"
        const total = range ? Number(range.split('/')[1]) : null;
        return r.text().then((t) => ({ t, total }));
      })
      .then(({ t, total }) => {
        setTruncated(total !== null ? total > t.length : t.length >= TEXT_LIMIT);
        setText(t.slice(0, TEXT_LIMIT));
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(true);
        void err;
      });
    return () => controller.abort();
  }, [node.id]);

  if (error) return <ViewerError />;
  if (text === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/70" />
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto p-6">
      <pre className="mx-auto max-w-4xl whitespace-pre-wrap break-words rounded-lg bg-surface p-5 font-mono text-[13px] leading-relaxed text-text">
        {text}
      </pre>
      {truncated ? (
        <p className="mx-auto mt-3 max-w-4xl text-center text-xs text-white/60">
          {t('viewer.truncated')}
        </p>
      ) : null}
    </div>
  );
}

export function DownloadCard({ node }: { node: FsNodeDto }): React.JSX.Element {
  const { t } = useTranslation('files');
  const Icon = nodeIcon(node);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon className="size-16 text-white/40" />
      <div>
        <div className="text-[15px] font-medium text-white">{node.name}</div>
        <div className="mt-1 text-[13px] text-white/60">{t('viewer.noInlinePreview')}</div>
      </div>
      <a href={downloadUrl(node.id)} target="_blank" rel="noopener noreferrer">
        <Button variant="secondary" size="sm">
          <Download className="size-4" /> {t('row.download')}
        </Button>
      </a>
    </div>
  );
}

export function ViewerError(): React.JSX.Element {
  const { t } = useTranslation('files');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
      <FileWarning className="size-10" />
      <p className="text-[13px]">{t('viewer.loadError')}</p>
    </div>
  );
}
