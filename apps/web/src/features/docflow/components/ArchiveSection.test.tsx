import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { ArchiveSection } from './ArchiveSection';

const { postMock, deleteMock } = vi.hoisted(() => ({ postMock: vi.fn(), deleteMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: postMock, patch: vi.fn(), delete: deleteMock },
  ApiError: class ApiError extends Error {},
}));

const doc = (over: Partial<DocumentDetailDto> = {}, archive: Record<string, unknown> = {}) =>
  ({
    id: 'd1',
    caseIndex: '01-01',
    availableActions: ['archive', 'legalHold'],
    archive: {
      archivedAt: null,
      archivedByName: null,
      retentionUntil: null,
      retentionMonths: null,
      isPermanent: false,
      legalHold: false,
      legalHoldReason: null,
      dispositionStatus: 'none',
      disposedAt: null,
      ...archive,
    },
    ...over,
  }) as unknown as DocumentDetailDto;

function renderSection(d: DocumentDetailDto): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <ArchiveSection doc={d} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('ArchiveSection', () => {
  beforeEach(() => {
    postMock.mockReset();
    deleteMock.mockReset();
  });

  it('shows the frozen term next to the months it came from', () => {
    renderSection(
      doc(
        { availableActions: ['restore'] },
        {
          archivedAt: '2026-01-15T10:00:00.000Z',
          archivedByName: 'Нурова Н.',
          retentionUntil: '2031-01-15T10:00:00.000Z',
          retentionMonths: 60,
        },
      ),
    );
    // «Почему именно эта дата» has to have an answer on the screen.
    expect(screen.getByText(/60 мес\./)).toBeInTheDocument();
    expect(screen.getByText(/Нурова Н\./)).toBeInTheDocument();
  });

  it('states a permanent case rather than an empty deadline', () => {
    renderSection(
      doc({ availableActions: [] }, { archivedAt: '2026-01-15T10:00:00.000Z', isPermanent: true }),
    );
    expect(screen.getByText('Постоянно')).toBeInTheDocument();
  });

  it('renders a legal hold loudly, with its reason', () => {
    renderSection(
      doc(
        { availableActions: ['legalHold'] },
        {
          archivedAt: '2026-01-15T10:00:00.000Z',
          legalHold: true,
          legalHoldReason: 'Судебный запрос №12',
        },
      ),
    );
    // A hold nobody can see is a hold somebody will try to work around.
    expect(screen.getByRole('alert')).toHaveTextContent('Судебный запрос №12');
    expect(screen.getByRole('button', { name: /Снять запрет/ })).toBeInTheDocument();
  });

  it('never restores without a reason, and sends the one given', async () => {
    postMock.mockResolvedValue({});
    renderSection(
      doc({ availableActions: ['restore'] }, { archivedAt: '2026-01-15T10:00:00.000Z' }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Изъять из дела/ }));
    const submit = screen.getAllByRole('button', { name: /Изъять из дела/ }).at(-1)!;
    expect(submit).toBeDisabled();
    // And it warns that the frozen term goes with it.
    expect(screen.getByText(/при повторной сдаче он будет рассчитан заново/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Основание'), {
      target: { value: 'Затребован для проверки' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/v1/docflow/documents/d1/actions/restore', {
        reason: 'Затребован для проверки',
      }),
    );
  });

  it('sends the hold reason both ways', async () => {
    deleteMock.mockResolvedValue({});
    renderSection(
      doc(
        { availableActions: ['legalHold'] },
        {
          archivedAt: '2026-01-15T10:00:00.000Z',
          legalHold: true,
          legalHoldReason: 'Судебный запрос',
        },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Снять запрет/ }));
    fireEvent.change(screen.getByLabelText('Основание'), { target: { value: 'Запрос закрыт' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Снять запрет/ }).at(-1)!);
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith('/v1/docflow/documents/d1/legal-hold', {
        reason: 'Запрос закрыт',
      }),
    );
  });

  it('stays out of the way on an ordinary working document', () => {
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <I18nextProvider i18n={i18n}>
          <ArchiveSection doc={doc({ availableActions: [] })} />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
