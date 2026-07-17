import { describe, expect, it } from 'vitest';
import type { ServiceStatus } from '@cuks/shared';
import { aggregate } from './admin-health.service';

const up = (key: string): ServiceStatus => ({ key: key as never, state: 'up' });
const down = (key: string): ServiceStatus => ({ key: key as never, state: 'down' });
const notConfigured = (key: string): ServiceStatus => ({
  key: key as never,
  state: 'down',
  note: 'not-configured',
});

describe('aggregate (overall platform status)', () => {
  it('is ok when every configured service is up', () => {
    expect(aggregate([up('postgres'), up('redis'), notConfigured('livekit')])).toBe('ok');
  });

  it('ignores not-configured services (they are not failures)', () => {
    // Only configured services are up -> ok, despite a not-configured one being state:down.
    expect(aggregate([up('postgres'), notConfigured('geoserver')])).toBe('ok');
  });

  it('is degraded when some (but not all) configured services are down', () => {
    expect(aggregate([up('postgres'), down('redis'), up('minio')])).toBe('degraded');
  });

  it('is down when every configured service is down', () => {
    expect(aggregate([down('postgres'), down('redis'), notConfigured('martin')])).toBe('down');
  });

  it('is ok when nothing is configured', () => {
    expect(aggregate([notConfigured('livekit'), notConfigured('geoserver')])).toBe('ok');
  });
});
