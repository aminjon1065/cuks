import { useTranslation } from 'react-i18next';
import { Download, Paperclip, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { Badge, fileIcon } from '@cuks/ui';
import type { DocumentFileDto } from '@cuks/shared';
import { PdfViewer } from '@/features/files/components/viewer/PdfViewer';
import { formatBytes } from '@/lib/format';
import { documentFileDownloadUrl } from '../lib/document';

/** Only a `clean` version is servable through the document endpoints — the row for
 *  anything else explains why instead of offering a dead link (docs/modules/11 §12.2). */
function isServable(file: DocumentFileDto): boolean {
  return file.avStatus === 'clean';
}

function AvNotice({ file }: { file: DocumentFileDto }): React.JSX.Element | null {
  const { t } = useTranslation('docflow');
  if (isServable(file)) return null;
  if (file.avStatus === 'infected') {
    return (
      <Badge tone="danger">
        <ShieldAlert className="size-3" aria-hidden /> {t('documents.files.infected')}
      </Badge>
    );
  }
  return (
    <Badge tone="warning">
      <ShieldQuestion className="size-3" aria-hidden /> {t('documents.files.scanning')}
    </Badge>
  );
}

function FileRow({
  documentId,
  file,
}: {
  documentId: string;
  file: DocumentFileDto;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const Icon = fileIcon(file.mime);
  const label = file.title ?? file.name;
  const meta = [
    t(`documents.fileKind.${file.kind}`),
    file.kind === 'main' ? `v${file.version}` : null,
    file.size > 0 ? formatBytes(file.size) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-2">
      <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text">{label}</span>
        <span className="block text-[11px] text-text-muted">{meta}</span>
      </span>
      <AvNotice file={file} />
      {isServable(file) ? (
        <a
          href={documentFileDownloadUrl(documentId, file.fileId)}
          className="rounded-sm p-1 text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={t('documents.files.download', { name: label })}
          title={t('documents.files.download', { name: label })}
        >
          <Download className="size-4" aria-hidden />
        </a>
      ) : null}
    </li>
  );
}

/**
 * The card's «Файлы» block (docs/modules/11 §7, plan этап 1C). Rows are real files —
 * name, size and antivirus state — and every read goes through the document-gated
 * endpoint, never a direct storage link. The current main body renders inline when it
 * is a cleared PDF.
 */
export function DocumentFilesSection({
  documentId,
  files,
}: {
  documentId: string;
  files: DocumentFileDto[];
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const mainPdf = files.find(
    (f) => f.kind === 'main' && f.isCurrent && f.mime === 'application/pdf' && isServable(f),
  );

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Paperclip className="size-4" aria-hidden /> {t('documents.card.files')}
      </h2>
      {files.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('documents.card.noFiles')}</p>
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {files.map((file) => (
            <FileRow key={file.id} documentId={documentId} file={file} />
          ))}
        </ul>
      )}
      {mainPdf ? (
        <div className="mt-4 border-t border-border pt-4">
          <PdfViewer src={documentFileDownloadUrl(documentId, mainPdf.fileId)} />
        </div>
      ) : null}
    </section>
  );
}
