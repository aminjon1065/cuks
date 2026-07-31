import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentFileDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { DocumentFilesSection } from './DocumentFilesSection';

// pdf.js pulls a worker bundle that jsdom cannot run; the section's contract here is
// *which* src it hands over, not the rendering.
vi.mock('@/features/files/components/viewer/PdfViewer', () => ({
  PdfViewer: ({ src }: { src: string }) => <div data-testid="pdf-viewer" data-src={src} />,
}));

const DOC_ID = '0190a000-0000-7000-8000-0000000000d1';

function file(over: Partial<DocumentFileDto> = {}): DocumentFileDto {
  return {
    id: 'link-1',
    fileId: '0190a000-0000-7000-8000-0000000000f1',
    kind: 'main',
    version: 1,
    title: null,
    isCurrent: true,
    createdAt: '2026-07-31T06:00:00.000Z',
    name: 'Письмо.pdf',
    mime: 'application/pdf',
    size: 2048,
    avStatus: 'clean',
    ...over,
  };
}

function renderSection(files: DocumentFileDto[]): void {
  render(
    <I18nextProvider i18n={i18n}>
      <DocumentFilesSection documentId={DOC_ID} files={files} />
    </I18nextProvider>,
  );
}

describe('DocumentFilesSection', () => {
  it('links a cleared file through the document-gated endpoint, never the storage', () => {
    renderSection([file()]);
    const link = screen.getByRole('link', { name: /Письмо\.pdf/ });
    expect(link).toHaveAttribute(
      'href',
      `/api/v1/docflow/documents/${DOC_ID}/files/${file().fileId}/download`,
    );
    expect(screen.getByText('Письмо.pdf')).toBeInTheDocument();
  });

  it('offers no download for an infected file and says why', () => {
    renderSection([file({ avStatus: 'infected' })]);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Заражён')).toBeInTheDocument();
  });

  it('offers no download while the scan is still pending', () => {
    // The server refuses it too — the UI just avoids handing out a link that 403s.
    renderSection([file({ avStatus: 'pending' })]);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Идёт проверка')).toBeInTheDocument();
  });

  it('previews the current main PDF inline, and only when it is cleared', () => {
    renderSection([file()]);
    expect(screen.getByTestId('pdf-viewer')).toHaveAttribute(
      'data-src',
      `/api/v1/docflow/documents/${DOC_ID}/files/${file().fileId}/download`,
    );
  });

  it('does not preview a superseded main file', () => {
    renderSection([file({ isCurrent: false })]);
    expect(screen.queryByTestId('pdf-viewer')).toBeNull();
  });

  it('does not preview a non-PDF or an unscanned main file', () => {
    renderSection([file({ mime: 'text/plain', name: 'Письмо.txt' })]);
    expect(screen.queryByTestId('pdf-viewer')).toBeNull();
  });

  it('shows the empty state when nothing is attached', () => {
    renderSection([]);
    expect(screen.getByText('Файлы не прикреплены')).toBeInTheDocument();
  });
});
