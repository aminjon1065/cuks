import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { DocflowSettingsPage } from './DocflowSettingsPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const journals = [
  {
    id: 'j1',
    code: 'incoming',
    name: 'Входящие документы',
    docClass: 'incoming',
    numberTemplate: '{ВХ}-{YYYY}/{seq4}',
    seqReset: 'yearly',
    orgUnitId: null,
    orgUnitName: null,
    sort: 1,
    isActive: true,
  },
];

function renderPage(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <DocflowSettingsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('DocflowSettingsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((path: string) =>
      path.startsWith('/v1/docflow/journals') ? Promise.resolve(journals) : Promise.resolve([]),
    );
  });

  it('renders the three reference-data tabs and the journals table', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Настройки ДОУ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Журналы' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Корреспонденты' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Номенклатура дел' })).toBeInTheDocument();
    // The seeded journal row loads from the (mocked) API.
    expect(await screen.findByText('Входящие документы')).toBeInTheDocument();
    expect(screen.getByText('{ВХ}-{YYYY}/{seq4}')).toBeInTheDocument();
  });

  it('switches to the correspondents tab and shows its empty state', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Корреспонденты' }));
    await waitFor(() => expect(screen.getByText('Корреспонденты не найдены')).toBeInTheDocument());
  });

  it('opens the create-journal dialog with a default number template', async () => {
    renderPage();
    await screen.findByText('Входящие документы');
    fireEvent.click(screen.getByRole('button', { name: /Добавить журнал/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('{П}-{YYYY}/{seq4}')).toBeInTheDocument();
  });
});
