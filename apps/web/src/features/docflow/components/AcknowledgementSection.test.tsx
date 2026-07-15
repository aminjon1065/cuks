import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { AcknowledgementSection } from './AcknowledgementSection';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const doc = { id: 'd1', status: 'on_route' } as unknown as DocumentDetailDto;

function renderSection(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <AcknowledgementSection doc={doc} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('AcknowledgementSection', () => {
  beforeEach(() => getMock.mockReset());

  it('renders the sheet with progress and the acknowledge action when pending', async () => {
    getMock.mockResolvedValue({
      rows: [
        {
          id: 'a1',
          userId: 'u1',
          userName: 'Иванов И.',
          position: 'Инспектор',
          acknowledgedAt: null,
        },
        {
          id: 'a2',
          userId: 'u2',
          userName: 'Петров П.',
          position: null,
          acknowledgedAt: '2026-07-15T06:00:00.000Z',
        },
      ],
      total: 2,
      acknowledged: 1,
      canAcknowledge: true,
      stepId: 's1',
    });
    renderSection();
    expect(await screen.findByText('Иванов И.')).toBeInTheDocument();
    expect(screen.getByText('1 из 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ознакомлен' })).toBeInTheDocument();
  });

  it('renders nothing when the document has no acknowledgement sheet', async () => {
    getMock.mockResolvedValue({
      rows: [],
      total: 0,
      acknowledged: 0,
      canAcknowledge: false,
      stepId: null,
    });
    renderSection();
    // Once the (empty) sheet resolves, the section collapses to null — no heading.
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Ознакомление')).not.toBeInTheDocument());
  });
});
