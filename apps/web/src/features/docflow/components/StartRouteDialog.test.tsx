import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { StartRouteDialog } from './StartRouteDialog';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

function renderDialog(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <StartRouteDialog documentId="d1" open onOpenChange={() => {}} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('StartRouteDialog', () => {
  beforeEach(() => getMock.mockReset());

  it('searches approvers on the server (not just a client-side slice) and adds one', async () => {
    // The directory endpoint is called WITH the typed query — proving server-side search,
    // so an approver outside the capped default list is still reachable.
    getMock.mockImplementation((path?: string) =>
      (path ?? '').includes('q=')
        ? Promise.resolve([
            { id: 'u9', fullName: 'Фамилия Ф.', shortName: 'Фамилия Ф.', username: 'famous' },
          ])
        : Promise.resolve([]),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText('Добавить согласующего'), {
      target: { value: 'Фамилия' },
    });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(expect.stringContaining('/directory/users?q=')),
    );
    const result = await screen.findByRole('button', { name: /Фамилия Ф\./ });
    fireEvent.click(result);
    // The picked approver becomes step 1 of the route.
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });
});
