import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { SignatureSection } from './SignatureSection';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/ability', () => ({ useCan: () => true }));

const signatures = [
  {
    id: 'sig1',
    userId: 'u1',
    userName: 'Начальник Н.',
    certificateId: 'c1',
    certificateSerial: 'abc123',
    algorithm: 'ECDSA_P256_SHA256',
    context: 'sign',
    signedAt: '2026-07-15T06:00:00.000Z',
    valid: true,
  },
];

const routesWithActiveSign = [
  {
    id: 'r1',
    cycle: 1,
    status: 'active',
    createdByName: 'Автор А.',
    createdAt: '2026-07-15T05:00:00.000Z',
    completedAt: null,
    steps: [
      {
        id: 's1',
        stepOrder: 1,
        kind: 'sign',
        assigneeType: 'user',
        assigneeId: 'u1',
        assigneeName: 'Начальник Н.',
        status: 'active',
        decision: null,
        comment: null,
        actedByName: null,
        actedAt: null,
        dueHours: null,
        canAct: true,
      },
    ],
  },
];

const doc = { id: 'd1', status: 'on_route' } as unknown as DocumentDetailDto;

function renderSection(): void {
  render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <I18nextProvider i18n={i18n}>
          <SignatureSection doc={doc} />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SignatureSection', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('lists a valid signature with a verification link', async () => {
    getMock.mockImplementation((path: string) =>
      path.includes('/signatures') ? Promise.resolve(signatures) : Promise.resolve([]),
    );
    renderSection();
    expect(await screen.findByText('Начальник Н.')).toBeInTheDocument();
    expect(screen.getByText('Действительна')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Проверить' });
    expect(link).toHaveAttribute('href', '/verify/sig1');
  });

  it('offers the Sign action when the caller has an active signing step', async () => {
    getMock.mockImplementation((path: string) =>
      path.includes('/routes') ? Promise.resolve(routesWithActiveSign) : Promise.resolve([]),
    );
    renderSection();
    expect(await screen.findByRole('button', { name: 'Подписать' })).toBeInTheDocument();
  });

  it('hides the Sign action without an active signing step', async () => {
    getMock.mockImplementation(() => Promise.resolve([]));
    renderSection();
    expect(await screen.findByText('Документ ещё не подписан.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подписать' })).not.toBeInTheDocument();
  });
});
