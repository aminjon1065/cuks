import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { DocumentsPage } from './DocumentsPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

// The create button and registry tab are permission-gated; grant them in the test.
vi.mock('@/lib/ability', () => ({ useCan: () => true }));

const documentsPage = {
  items: [
    {
      id: 'd1',
      regNumber: 'П-2026/0001',
      docClass: 'internal',
      typeCode: 'order',
      subject: 'О мерах по предупреждению ЧС',
      status: 'registered',
      confidentiality: 'normal',
      journalName: 'Приказы',
      authorName: 'Иванов И.',
      correspondentName: null,
      dueDate: null,
      regDate: '2026-07-15T06:00:00.000Z',
      createdAt: '2026-07-15T06:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 50,
};

function renderPage(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/app/docs']}>
          <DocumentsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((path: string) =>
      path.startsWith('/v1/docflow/documents')
        ? Promise.resolve(documentsPage)
        : Promise.resolve([]),
    );
  });

  it('renders the cabinet with queue tabs and a document row', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Кабинет ДОУ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Мои документы' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Черновики' })).toBeInTheDocument();
    // Registry tab shows because useCan is mocked to true.
    expect(screen.getByRole('tab', { name: 'Реестр' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Создать документ/ })).toBeInTheDocument();

    const subjectCell = await screen.findByText('О мерах по предупреждению ЧС');
    expect(screen.getByText('П-2026/0001')).toBeInTheDocument();
    // The row's status badge (scoped, since the filter dropdown also lists the label).
    const row = subjectCell.closest('tr');
    expect(within(row!).getByText('Зарегистрирован')).toBeInTheDocument();
  });
});
