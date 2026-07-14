import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { GisPublicationService } from './gis-publication.service';
import type { AuthUser } from '../../common/auth/auth-user';

const USER = { id: 'u1', username: 'admin', isSuperadmin: true } as unknown as AuthUser;
const dialect = new PgDialect();

/** Render the SQL object drizzle would send, so we can assert on the literal text and
 *  its bind parameters — exactly what PostgreSQL receives. */
function render(q: SQL): { sql: string; params: unknown[] } {
  const { sql, params } = dialect.sqlToQuery(q);
  return { sql, params };
}

function makeService(layer: Record<string, unknown>) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    execute: vi.fn(async (q: SQL) => {
      executed.push(render(q));
      return { rows: [] };
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => [layer] }) }),
    }),
  };
  const layers = {
    requireLayer: async () => layer,
    assertManage: async () => undefined,
    toPublicDto: (row: unknown) => row,
  };
  const geoserver = { configured: true, publish: vi.fn(async () => 'cuks:v_test') };
  const audit = { log: vi.fn() };
  const service = new GisPublicationService(
    db as never,
    layers as never,
    geoserver as never,
    audit as never,
  );
  return { service, executed, geoserver };
}

describe('GisPublicationService drawn-layer view', () => {
  const drawn = {
    id: '019f62b3-dec2-7cb4-ab2d-3d19927cfc45',
    slug: 'road-works',
    kind: 'drawn',
    tableName: null,
    isPublishedWms: false,
    geoserverLayer: null,
  };

  it('creates an updatable, layer-scoped view GeoServer can serve for WFS-T', async () => {
    const { service, executed, geoserver } = makeService(drawn);
    await service.publish(drawn.id, USER);

    const ddl = executed.map((e) => e.sql).join('\n');
    // The layer id must be INLINED, never a bind parameter: PostgreSQL rejects
    // parameters in a stored view body or a column DEFAULT.
    expect(executed.every((e) => e.params.length === 0)).toBe(true);
    expect(ddl).toContain(`WHERE layer_id = '${drawn.id}'::uuid`);
    // Confine every WFS-T write to this one layer.
    expect(ddl).toContain('WITH CASCADED CHECK OPTION');
    // Both NOT NULL columns a direct client omits get a DEFAULT so INSERT succeeds.
    expect(ddl).toContain('ALTER COLUMN id SET DEFAULT gen_random_uuid()');
    expect(ddl).toContain(`ALTER COLUMN layer_id SET DEFAULT '${drawn.id}'::uuid`);
    // The view name GeoServer publishes is derived from the slug.
    expect(geoserver.publish).toHaveBeenCalledWith('v_road_works');
  });

  it('rejects a layer id that is not a UUID before it reaches the SQL string', async () => {
    const { service } = makeService({ ...drawn, id: "x'; DROP TABLE gis.layers; --" });
    await expect(service.publish(drawn.id, USER)).rejects.toMatchObject({
      code: 'gis.layer.bad_id',
    });
  });
});
