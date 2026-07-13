import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { RequestContextInterceptor } from './request-context.interceptor';
import { getRequestContext, type RequestContextStore } from '../request-context/request-context';

function httpContext(request: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe('RequestContextInterceptor', () => {
  it('seeds ip/user-agent/actor for the handler', () => {
    const interceptor = new RequestContextInterceptor();
    let captured: RequestContextStore | undefined;
    const next = {
      handle: () => {
        captured = getRequestContext();
        return of(null);
      },
    };
    const request = { ip: '1.2.3.4', headers: { 'user-agent': 'UA' }, authUser: { id: 'u1' } };

    interceptor.intercept(httpContext(request) as never, next as never);

    expect(captured).toEqual({ ip: '1.2.3.4', userAgent: 'UA', actorId: 'u1' });
  });

  it('leaves anonymous requests with null actor', () => {
    const interceptor = new RequestContextInterceptor();
    let captured: RequestContextStore | undefined;
    const next = {
      handle: () => {
        captured = getRequestContext();
        return of(null);
      },
    };
    interceptor.intercept(httpContext({ ip: '5.6.7.8', headers: {} }) as never, next as never);
    expect(captured).toEqual({ ip: '5.6.7.8', userAgent: null, actorId: null });
  });

  it('does not touch non-http contexts', () => {
    const interceptor = new RequestContextInterceptor();
    let handled = false;
    const next = {
      handle: () => {
        handled = true;
        return of(null);
      },
    };
    const wsContext = { getType: () => 'ws' };
    interceptor.intercept(wsContext as never, next as never);
    expect(handled).toBe(true);
  });
});
