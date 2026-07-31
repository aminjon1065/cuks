import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto, ResolutionProposalDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { ProposalsSection } from './ProposalsSection';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: postMock, patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/ability', () => ({ useCan: () => true }));

const doc = { id: 'd1', regNumber: 'ВХ-2026/0001' } as unknown as DocumentDetailDto;

const base: ResolutionProposalDto = {
  id: 'p1',
  documentId: 'd1',
  text: 'Ознакомить и исполнить',
  status: 'pending',
  signerId: 'u-signer',
  signerName: 'Рахимов Р.',
  resolutionTypeId: null,
  responsibleExecutorId: 'u-exec',
  responsibleExecutorName: 'Каримов К.',
  coExecutorIds: [],
  acquaintUserIds: [],
  dueAt: null,
  isControl: false,
  proposedByName: 'Нурова Н.',
  submittedAt: '2026-07-30T05:00:00.000Z',
  decidedByName: null,
  decidedForName: null,
  decidedAt: null,
  decisionComment: null,
  resolutionId: null,
  canDecide: false,
  canEdit: false,
  gate: null,
  createdAt: '2026-07-30T05:00:00.000Z',
};

/** `/auth/me` answers the gate block's «is this line mine» question. */
function mockApi(proposals: ResolutionProposalDto[], meId = 'u-me'): void {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/auth/me')) return Promise.resolve({ id: meId });
    if (url.includes('resolution-proposals')) return Promise.resolve(proposals);
    return Promise.resolve([]);
  });
}

function renderSection(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <ProposalsSection doc={doc} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('ProposalsSection', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('offers the decision only to the caller the server marked as its decider', async () => {
    mockApi([base]);
    renderSection();
    expect(await screen.findByText('Ознакомить и исполнить')).toBeInTheDocument();
    // canDecide is false: a bystander reads the proposal but is offered nothing to press.
    expect(screen.queryByRole('button', { name: /Утвердить/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Вернуть/ })).not.toBeInTheDocument();
  });

  it('returns a proposal only with a reason, and sends the comment', async () => {
    mockApi([{ ...base, canDecide: true }]);
    postMock.mockResolvedValue({ ...base, status: 'rejected' });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Вернуть/ }));
    const submit = screen.getAllByRole('button', { name: /Вернуть/ }).at(-1)!;
    // The drafter has to know what to fix, so an empty return is not offered.
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Причина возврата'), {
      target: { value: 'Уточните срок' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/v1/docflow/resolution-proposals/p1/actions/reject', {
        comment: 'Уточните срок',
      }),
    );
  });

  it('counts the gate down and shows who has not read the document yet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-30T06:00:00.000Z'));
    mockApi([
      {
        ...base,
        status: 'approved',
        resolutionId: 'r1',
        gate: {
          id: 'b1',
          releaseAt: '2026-07-30T08:30:00.000Z', // 2h30m out
          releasedAt: null,
          releasedReason: null,
          lines: [
            {
              userId: 'u-me',
              userName: 'Я',
              status: 'pending',
              acknowledgedAt: null,
            },
            {
              userId: 'u2',
              userName: 'Петров П.',
              status: 'acknowledged',
              acknowledgedAt: '2026-07-30T06:10:00.000Z',
            },
          ],
        },
      },
    ]);
    renderSection();

    // The clock keeps running while the query resolves, so the seconds may already have
    // ticked past the round 02:30:00 — what matters is that it counts down from now.
    expect(await screen.findByText(/Автооткрытие через 02:(30:00|29:5\d)/)).toBeInTheDocument();
    expect(screen.getByText('1 из 2')).toBeInTheDocument();
    // The caller still owes a reading, so the gate offers them the confirmation.
    expect(screen.getByRole('button', { name: 'Ознакомлен' })).toBeInTheDocument();
  });

  it('reports a released gate by the reason it opened for', async () => {
    mockApi([
      {
        ...base,
        status: 'approved',
        resolutionId: 'r1',
        gate: {
          id: 'b1',
          releaseAt: '2026-07-30T08:30:00.000Z',
          releasedAt: '2026-07-30T08:30:00.000Z',
          releasedReason: 'timeout',
          // A lapsed deadline is not a reading: the line reads «Не ознакомился».
          lines: [{ userId: 'u-me', userName: 'Я', status: 'expired', acknowledgedAt: null }],
        },
      },
    ]);
    renderSection();

    expect(await screen.findByText('Открыто по истечении срока')).toBeInTheDocument();
    expect(screen.getByText('Не ознакомился')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ознакомлен' })).not.toBeInTheDocument();
  });
});
