import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { RouteSection } from './RouteSection';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const routes = [
  {
    id: 'r1',
    cycle: 1,
    status: 'active',
    createdByName: 'Автор А.',
    createdAt: '2026-07-15T06:00:00.000Z',
    completedAt: null,
    steps: [
      {
        id: 's1',
        stepOrder: 1,
        kind: 'approve',
        assigneeType: 'user',
        assigneeId: 'u1',
        assigneeName: 'Согласующий С.',
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

const doc = {
  id: 'd1',
  status: 'on_route',
  canEdit: false,
} as unknown as DocumentDetailDto;

function renderSection(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <RouteSection doc={doc} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('RouteSection', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((path: string) =>
      path.includes('/routes') ? Promise.resolve(routes) : Promise.resolve([]),
    );
  });

  it('renders the route stepper with the active step and an approve action', async () => {
    renderSection();
    expect(screen.getByRole('heading', { name: 'Маршрут' })).toBeInTheDocument();
    expect(await screen.findByText('Цикл 1')).toBeInTheDocument();
    expect(screen.getByText('Согласующий С.')).toBeInTheDocument();
    // The caller can act on the active step → approve/reject buttons show.
    expect(screen.getByRole('button', { name: 'Согласовать' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeInTheDocument();
  });
});
