import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetailDto, DocumentDispatchDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { DispatchSection } from './DispatchSection';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  api: { get: getMock, post: postMock, patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
// The upload widget owns a whole presigned-multipart flow; the section only needs the id.
vi.mock('@/features/uploads', () => ({
  AttachmentField: () => <div data-testid="attachment-field" />,
}));

const doc = (over: Partial<DocumentDetailDto> = {}) =>
  ({
    id: 'd1',
    docClass: 'outgoing',
    regNumber: 'ИСХ-2026/0007',
    recipientName: 'Министерство энергетики РТ',
    recipientContact: null,
    availableActions: ['dispatch'],
    ...over,
  }) as unknown as DocumentDetailDto;

const attempt = (over: Partial<DocumentDispatchDto> = {}): DocumentDispatchDto => ({
  id: 'a1',
  documentId: 'd1',
  channel: 'postal',
  status: 'pending',
  recipientName: 'Министерство энергетики РТ',
  recipientAddress: 'г. Душанбе, пр. Рудаки, 1',
  recipientContact: null,
  externalReference: null,
  note: null,
  failureCode: null,
  failureMessage: null,
  attemptedAt: '2026-07-31T06:00:00.000Z',
  sentAt: null,
  createdByName: 'Нурова Н.',
  confirmedByName: null,
  receipt: null,
  canAct: true,
  createdAt: '2026-07-31T06:00:00.000Z',
  ...over,
});

function renderSection(attempts: DocumentDispatchDto[], d = doc()): void {
  getMock.mockResolvedValue(attempts);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <DispatchSection doc={d} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('DispatchSection', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('shows the whole attempt log, failure and success side by side', async () => {
    renderSection([
      attempt({ id: 'a2', status: 'sent', sentAt: '2026-07-31T09:00:00.000Z' }),
      attempt({
        id: 'a1',
        status: 'failed',
        failureMessage: 'Конверт вернулся: адрес изменился',
      }),
    ]);
    // A panel showing only the success would quietly erase the failure it followed.
    expect(await screen.findByText(/Конверт вернулся/)).toBeInTheDocument();
    expect(screen.getByText('Отправлено')).toBeInTheDocument();
    expect(screen.getByText('Не доставлено')).toBeInTheDocument();
  });

  it('offers retry on a spent attempt and decisions only on an open one', async () => {
    renderSection([attempt({ status: 'failed' })]);
    expect(await screen.findByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Подтвердить отправку/ })).not.toBeInTheDocument();
  });

  it('sends a failure with the reason the operator typed', async () => {
    renderSection([attempt()]);
    fireEvent.click(await screen.findByRole('button', { name: /Отметить неудачу/ }));
    const dialogSubmit = screen.getAllByRole('button', { name: /Отметить неудачу/ }).at(-1)!;
    // A failure with no reason tells the next attempt nothing.
    expect(dialogSubmit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Причина'), {
      target: { value: 'Адресат отказался принять' },
    });
    fireEvent.click(dialogSubmit);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/v1/docflow/dispatches/a1/actions/fail', {
        failureCode: 'manual',
        failureMessage: 'Адресат отказался принять',
      }),
    );
  });

  it('says why nothing can be sent yet on an unregistered document', async () => {
    renderSection([], doc({ regNumber: null, availableActions: [] }));
    expect(
      await screen.findByText('Отправка возможна после регистрации документа.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Зафиксировать отправку/ }),
    ).not.toBeInTheDocument();
  });
  it('keeps the track number recorded when the attempt was opened', async () => {
    renderSection([attempt({ externalReference: 'RB123456789TJ' })]);
    fireEvent.click(await screen.findByRole('button', { name: /Подтвердить отправку/ }));
    // Seeded from the attempt: an empty field here would clear what the clerk typed days ago.
    expect(screen.getByLabelText('Трек-номер / идентификатор')).toHaveValue('RB123456789TJ');

    fireEvent.click(screen.getAllByRole('button', { name: /Подтвердить отправку/ }).at(-1)!);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/v1/docflow/dispatches/a1/actions/confirm', {
        externalReference: 'RB123456789TJ',
        receiptFileId: null,
      }),
    );
  });

  it('does not offer a receipt link the antivirus has not cleared', async () => {
    renderSection([
      attempt({
        status: 'sent',
        receipt: {
          fileId: 'f1',
          name: 'kvitanciya.pdf',
          size: 10,
          mime: null,
          avStatus: 'pending',
        },
      }),
    ]);
    // The download endpoint serves only a clean version — a link would land on a raw 403.
    expect(await screen.findByText('kvitanciya.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /kvitanciya/ })).not.toBeInTheDocument();
    expect(screen.getByText('Идёт проверка')).toBeInTheDocument();
  });

  it('says a send is not applicable at all outside an outgoing document', async () => {
    renderSection([], doc({ docClass: 'internal', regNumber: 'П-1', availableActions: [] }));
    expect(
      await screen.findByText('Отправка ведётся только по исходящим документам.'),
    ).toBeInTheDocument();
  });
});
