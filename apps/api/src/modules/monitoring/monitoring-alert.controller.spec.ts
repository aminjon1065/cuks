import { describe, expect, it, vi } from 'vitest';
import { MonitoringAlertController } from './monitoring-alert.controller';

function make(over: { enabled?: boolean; secret?: string } = {}) {
  const alerts = {
    enabled: over.enabled ?? true,
    secret: over.secret ?? 'topsecret',
    postAlert: vi.fn().mockResolvedValue(undefined),
  };
  return { controller: new MonitoringAlertController(alerts as never), alerts };
}

describe('MonitoringAlertController.alert', () => {
  it('404s when the webhook is not configured', async () => {
    const { controller } = make({ enabled: false });
    await expect(controller.alert('topsecret', {})).rejects.toMatchObject({
      code: 'monitoring.alert.disabled',
    });
  });

  it('403s on a missing or wrong secret (constant-time compare)', async () => {
    const { controller, alerts } = make({ secret: 'topsecret' });
    await expect(controller.alert(undefined, {})).rejects.toMatchObject({
      code: 'monitoring.alert.forbidden',
    });
    await expect(controller.alert('wrong', {})).rejects.toMatchObject({
      code: 'monitoring.alert.forbidden',
    });
    expect(alerts.postAlert).not.toHaveBeenCalled();
  });

  it('posts the Uptime Kuma msg on a valid secret', async () => {
    const { controller, alerts } = make({ secret: 'topsecret' });
    const res = await controller.alert('topsecret', { msg: '[API] [🔴 Down] connection refused' });
    expect(res).toEqual({ ok: true });
    expect(alerts.postAlert).toHaveBeenCalledWith('[API] [🔴 Down] connection refused');
  });

  it('builds a fallback line when there is no msg field', async () => {
    const { controller, alerts } = make({ secret: 'topsecret' });
    await controller.alert('topsecret', {
      monitor: { name: 'GeoServer' },
      heartbeat: { status: 0 },
    });
    expect(alerts.postAlert).toHaveBeenCalledWith('Мониторинг: GeoServer — недоступен');
  });

  it('does not 500 on a null / bodyless POST (normalises to a fallback line)', async () => {
    const { controller, alerts } = make({ secret: 'topsecret' });
    await expect(controller.alert('topsecret', null)).resolves.toEqual({ ok: true });
    await expect(controller.alert('topsecret', undefined)).resolves.toEqual({ ok: true });
    expect(alerts.postAlert).toHaveBeenCalledWith('Мониторинг: сервис — недоступен');
  });
});
