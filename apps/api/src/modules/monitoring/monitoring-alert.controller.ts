import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { MonitoringAlertService } from './monitoring-alert.service';

/**
 * Inbound monitoring-alert webhook (docs/modules/16 §7, task 7.3). Uptime Kuma POSTs its notification
 * here with the shared secret in `X-Monitoring-Secret`; a matching alert becomes a system message in the
 * configured channel. @Public (no session/CSRF — it's a machine caller); the shared secret is the gate.
 */
@Controller({ path: 'monitoring', version: VERSION_NEUTRAL })
export class MonitoringAlertController {
  constructor(private readonly alerts: MonitoringAlertService) {}

  @Public()
  @Post('alert')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async alert(
    @Headers('x-monitoring-secret') provided: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    if (!this.alerts.enabled) {
      throw AppException.notFound(
        'monitoring.alert.disabled',
        'Monitoring alerts are not configured',
      );
    }
    if (!secretMatches(this.alerts.secret, provided)) {
      throw AppException.forbidden('monitoring.alert.forbidden', 'Invalid monitoring secret');
    }
    await this.alerts.postAlert(alertText(body));
    return { ok: true };
  }
}

/** Constant-time secret comparison (avoids a timing oracle on the shared secret). */
function secretMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build a readable line from an Uptime Kuma payload ({ msg, monitor, heartbeat }) or fall back. The
 *  body is unvalidated (Fastify delivers null for a literal `null` JSON body, undefined for a bodyless
 *  POST), so normalise to an object before dereferencing — a malformed ping must not 500. */
function alertText(raw: unknown): string {
  const body = asRecord(raw) ?? {};
  if (typeof body.msg === 'string' && body.msg.trim()) return body.msg.trim();
  const monitor = asRecord(body.monitor);
  const heartbeat = asRecord(body.heartbeat);
  const name = typeof monitor?.name === 'string' ? monitor.name : 'сервис';
  const status = heartbeat?.status === 1 ? 'восстановлен' : 'недоступен';
  return `Мониторинг: ${name} — ${status}`;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}
