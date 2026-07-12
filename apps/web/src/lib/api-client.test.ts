import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER } from '@cuks/shared';
import { ApiError, api } from './api-client';

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'cuks_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('api-client', () => {
  it('sends the CSRF token header on mutating requests', async () => {
    document.cookie = 'cuks_csrf=tok-123';
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/auth/logout');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('tok-123');
    expect(init.credentials).toBe('include');
  });

  it('omits the CSRF header on safe requests', async () => {
    document.cookie = 'cuks_csrf=tok-123';
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { id: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/auth/me');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBeUndefined();
  });

  it('unpacks the standard error envelope into an ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse(403, { error: { code: 'permission.denied', message: 'no' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/auth/me')).rejects.toMatchObject({
      code: 'permission.denied',
      status: 403,
    });
    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
  });
});
