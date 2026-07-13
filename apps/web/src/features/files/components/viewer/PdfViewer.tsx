import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { FsNodeDto } from '@cuks/shared';
import { downloadUrl } from '../../lib';
import { ViewerError } from './viewers';

// Bundle the worker locally (Vite `?url`) — no CDN (docs/02 invariants).
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAIN_MAX_WIDTH = 900;
const THUMB_WIDTH = 116;
// Cap how many page thumbnails render a preview canvas — beyond this, the rail
// shows plain page-number buttons so a giant PDF can't allocate thousands of
// canvases (the main view already renders only the current page).
const MAX_THUMB_CANVASES = 80;

/** Renders one PDF page to a canvas. Errors (e.g. the document being destroyed
 *  mid-render during rapid navigation) are swallowed rather than left as
 *  unhandled promise rejections. */
function PdfPageCanvas({
  pdf,
  pageNumber,
  targetWidth,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  targetWidth: number;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414); // A4-ish until the page is measured

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(base.height / base.width);
        const viewport = page.getViewport({ scale: targetWidth / base.width });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        task = page.render({ canvas, canvasContext: ctx, viewport });
        await task.promise;
      } catch {
        // getPage/render reject when the doc is destroyed mid-flight — ignore.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, targetWidth]);

  return (
    <div
      className="relative bg-surface shadow-[0_1px_2px_rgba(15,23,42,.06)]"
      style={{ width: targetWidth, height: targetWidth * ratio }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export function PdfViewer({ node }: { node: FsNodeDto }): React.JSX.Element {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setPdf(null);
    setError(false);
    setPage(1);
    void (async () => {
      try {
        // One credentialed fetch (cookie → same-origin API → 302 → MinIO bytes,
        // CORS-readable) then hand the bytes to pdf.js — avoids threading
        // credentials/redirects through pdf.js's own range loader.
        const res = await fetch(downloadUrl(node.id), { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.arrayBuffer();
        if (cancelled) return;
        task = pdfjsLib.getDocument({ data });
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setPdf(doc);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy(); // destroys the document + worker
    };
  }, [node.id]);

  const numPages = pdf?.numPages ?? 0;
  const goTo = (p: number): void => {
    const clamped = Math.min(Math.max(1, p), numPages);
    setPage(clamped);
    thumbRefs.current[clamped - 1]?.scrollIntoView({ block: 'nearest' });
  };

  // Page up/down keys move pages (←/→ are reserved by the overlay for files).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'PageDown' || e.key === 'ArrowDown') {
        e.preventDefault();
        goTo(page + 1);
      } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        goTo(page - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, numPages]);

  if (error) return <ViewerError />;
  if (!pdf) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/70" />
      </div>
    );
  }

  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div className="flex h-full">
      {/* Thumbnail rail */}
      <div className="hidden w-40 shrink-0 overflow-y-auto border-r border-white/10 bg-black/20 p-3 md:block">
        <div className="flex flex-col items-center gap-3">
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              ref={(el) => {
                thumbRefs.current[p - 1] = el;
              }}
              onClick={() => goTo(p)}
              className={`flex flex-col items-center gap-1 rounded p-1 ${
                p === page ? 'bg-white/15' : 'hover:bg-white/5'
              }`}
              aria-label={`page ${p}`}
              aria-current={p === page}
            >
              {p <= MAX_THUMB_CANVASES ? (
                <PdfPageCanvas pdf={pdf} pageNumber={p} targetWidth={THUMB_WIDTH} />
              ) : (
                <span
                  className="flex items-center justify-center bg-surface text-text-muted"
                  style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * 1.3 }}
                >
                  {p}
                </span>
              )}
              <span className="text-xs text-white/50">{p}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main: only the current page renders (bounded memory) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-center gap-3 border-b border-white/10 py-2 text-[13px] text-white/80">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page <= 1}
            className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
            aria-label="prev page"
          >
            <ChevronUp className="size-4" />
          </button>
          <span className="tabular-nums">
            {page} / {numPages}
          </span>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page >= numPages}
            className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
            aria-label="next page"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="flex justify-center py-6">
            <PdfPageCanvas key={page} pdf={pdf} pageNumber={page} targetWidth={MAIN_MAX_WIDTH} />
          </div>
        </div>
      </div>
    </div>
  );
}
