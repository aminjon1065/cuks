import { describe, expect, it, vi } from 'vitest';
import { AuditMaintenanceProcessor } from './audit-maintenance.processor';

/** Stands in for JobMetricsService — records the calls the job makes, never fails. */
function makeMetrics() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

describe('AuditMaintenanceProcessor', () => {
  it('ensures the current month plus two ahead', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };
    const processor = new AuditMaintenanceProcessor(db as never, makeMetrics() as never);

    await processor.process({} as never);

    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('records a successful run with no counts', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const processor = new AuditMaintenanceProcessor(db as never, metrics as never);

    await processor.process({} as never);

    expect(metrics.record).toHaveBeenCalledTimes(1);
    const [job, , outcome] = metrics.record.mock.calls[0]!;
    expect(job).toBe('audit-maintenance');
    // The DB function is idempotent and reports nothing about what it created; that the run
    // happened at all is the whole signal for a monthly job.
    expect(outcome).toEqual({ ok: true, counts: {} });
  });

  it('records a failure and still propagates it, so BullMQ retries as before', async () => {
    const boom = new Error('permission denied for schema audit');
    const db = { execute: vi.fn().mockRejectedValue(boom) };
    const metrics = makeMetrics();
    const processor = new AuditMaintenanceProcessor(db as never, metrics as never);

    await expect(processor.process({} as never)).rejects.toThrow(boom);

    expect(metrics.record).toHaveBeenCalledTimes(1);
    const [job, , outcome] = metrics.record.mock.calls[0]!;
    expect(job).toBe('audit-maintenance');
    expect(outcome).toEqual({ ok: false, error: boom });
  });
});
