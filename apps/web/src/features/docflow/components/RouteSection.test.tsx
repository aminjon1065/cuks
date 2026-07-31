import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { RouteSection } from './RouteSection';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: postMock, patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const step = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const routeWith = (steps: ReturnType<typeof step>[]) => [
  {
    id: 'r1',
    cycle: 1,
    status: 'active',
    createdByName: 'Автор А.',
    createdAt: '2026-07-15T06:00:00.000Z',
    completedAt: null,
    steps,
  },
];

const routes = routeWith([step()]);

const doc = {
  id: 'd1',
  status: 'on_route',
  availableActions: [],
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

/** Point the mocked route query at a specific set of steps. */
function withSteps(steps: ReturnType<typeof step>[]): void {
  getMock.mockImplementation((path: string) =>
    path.includes('/routes') ? Promise.resolve(routeWith(steps)) : Promise.resolve([]),
  );
}

describe('RouteSection', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue([]);
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

  it('offers «Исполнено» on an execute step and posts the complete action', async () => {
    withSteps([step({ kind: 'execute' })]);
    renderSection();
    const button = await screen.findByRole('button', { name: 'Исполнено' });
    expect(screen.queryByRole('button', { name: 'Согласовать' })).toBeNull();
    fireEvent.click(button);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/v1/docflow/route-steps/s1/actions/complete',
        expect.anything(),
      ),
    );
  });

  it.each([
    ['sign', 'Завершается подписанием'],
    ['acknowledge', 'Завершается, когда все ознакомятся'],
    ['register', 'Завершается регистрацией'],
  ])('shows where a %s step is completed instead of a dead button', async (kind, hint) => {
    // The server refuses `approve` on these kinds, so the card must not offer it —
    // it points at the surface that actually completes the step.
    withSteps([step({ kind })]);
    renderSection();
    expect(await screen.findByText(hint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Исполнено' })).toBeNull();
    // Declining stays available — it is the recovery path on every kind.
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeInTheDocument();
  });
});
