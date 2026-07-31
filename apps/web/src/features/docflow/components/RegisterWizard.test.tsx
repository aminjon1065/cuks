import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { RegisterWizard } from './RegisterWizard';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: postMock, patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const JOURNAL = {
  id: '0190a000-0000-7000-8000-000000000001',
  code: 'in',
  name: 'Входящие',
  docClass: 'incoming',
  numberTemplate: '{seq4}',
  seqReset: 'yearly',
  orgUnitId: null,
  orgUnitName: null,
  sort: 0,
  isActive: true,
};

function renderWizard(): void {
  render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <I18nextProvider i18n={i18n}>
          <RegisterWizard onClose={() => {}} />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Fill the one required field and submit. */
async function submitWizard(subject = 'Письмо о паводке'): Promise<void> {
  await screen.findByRole('option', { name: 'Входящие' });
  fireEvent.change(screen.getByLabelText('Тема'), { target: { value: subject } });
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать' }));
}

describe('RegisterWizard', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path?: string) =>
      (path ?? '').includes('/docflow/journals') ? Promise.resolve([JOURNAL]) : Promise.resolve([]),
    );
  });

  it('registers with ONE atomic command, not create → attach → register', async () => {
    postMock.mockResolvedValue({ id: 'doc-1', regNumber: '0001' });
    renderWizard();
    await submitWizard();

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/v1/docflow/documents/register-incoming');
    expect(body).toMatchObject({
      journalId: JOURNAL.id,
      subject: 'Письмо о паводке',
      typeCode: 'letter',
      files: [],
    });
    // The key is what makes a retry safe; without it the server cannot recognise a replay.
    expect(body.idempotencyKey).toEqual(expect.any(String));
  });

  it('reuses the same idempotency key on retry, so a lost response cannot double-register', async () => {
    // First attempt fails the way a dropped connection does — the server may or may not
    // have committed. Pressing the button again must replay the SAME command.
    postMock.mockRejectedValueOnce(new Error('network'));
    postMock.mockResolvedValueOnce({ id: 'doc-1', regNumber: '0001' });
    renderWizard();
    await submitWizard();

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Зарегистрировать' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));

    const first = postMock.mock.calls[0]?.[1] as { idempotencyKey: string };
    const second = postMock.mock.calls[1]?.[1] as { idempotencyKey: string };
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
