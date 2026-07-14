import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoServerService } from './geoserver.service';

/** A ConfigService double reading from a flat map. */
function config(values: Record<string, unknown>) {
  return {
    get: (key: string) => values[key],
  } as never;
}

const CONFIGURED = {
  GEOSERVER_URL: 'http://geoserver:8080/geoserver',
  GEOSERVER_ADMIN_USER: 'admin',
  GEOSERVER_ADMIN_PASSWORD: 'secret',
  GEOSERVER_WORKSPACE: 'cuks',
  GEOSERVER_PG_HOST: 'postgres',
  GEOSERVER_PG_PORT: 5432,
  GEOSERVER_PG_USER: 'gis_reader',
  GEOSERVER_PG_PASSWORD: 'pw',
  GIS_PG_PUBLIC_DATABASE: 'cuks',
};

afterEach(() => vi.restoreAllMocks());

describe('GeoServerService.configured', () => {
  it('is false without a URL or password (the map still works)', () => {
    expect(new GeoServerService(config({})).configured).toBe(false);
    expect(
      new GeoServerService(config({ GEOSERVER_URL: 'http://x', GEOSERVER_ADMIN_USER: 'a' }))
        .configured,
    ).toBe(false);
  });

  it('is true and exposes the workspace when fully configured', () => {
    const service = new GeoServerService(config(CONFIGURED));
    expect(service.configured).toBe(true);
    expect(service.workspace).toBe('cuks');
  });
});

describe('GeoServerService.publish', () => {
  it('ensures workspace + datastore + feature type, tolerating "already there"', async () => {
    const calls: { method: string; url: string }[] = [];
    // Everything already exists: GET → 200, so no POST is needed.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input) });
      return new Response('{}', { status: 200 });
    });

    const service = new GeoServerService(config(CONFIGURED));
    const layer = await service.publish('l_roads');
    expect(layer).toBe('cuks:l_roads');
    // Basic auth header + the workspace/datastore/featuretype probes.
    expect(calls.some((c) => c.url.includes('/rest/workspaces/cuks'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/datastores/gis'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/featuretypes/l_roads'))).toBe(true);
  });

  it('creates what is missing (POST) and surfaces a GeoServer error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      // Workspace and datastore exist; the feature type does not and its POST fails.
      if (method === 'GET' && url.includes('/featuretypes/l_roads')) {
        return new Response('', { status: 404 });
      }
      if (method === 'POST' && url.endsWith('/featuretypes')) {
        return new Response('boom', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    });
    const service = new GeoServerService(config(CONFIGURED));
    await expect(service.publish('l_roads')).rejects.toMatchObject({
      code: 'gis.geoserver.request_failed',
    });
  });

  it('throws a clear code when GeoServer is not configured', async () => {
    const service = new GeoServerService(config({}));
    await expect(service.publish('l_roads')).rejects.toMatchObject({
      code: 'gis.geoserver.not_configured',
    });
  });
});

describe('GeoServerService.unpublish', () => {
  it('deletes the feature type and treats a missing one as already gone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const service = new GeoServerService(config(CONFIGURED));
    await expect(service.unpublish('l_roads')).resolves.toBeUndefined();
  });
});
