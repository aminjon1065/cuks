import { describe, expect, it } from 'vitest';
import { buildReportQuery, presetForm, queryToForm, DEFAULT_REPORT_FORM } from './report';

const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('buildReportQuery', () => {
  it('derives a rolling window from the period and drops empty filters', () => {
    const query = buildReportQuery({ ...DEFAULT_REPORT_FORM, period: 'week' }, NOW);
    expect(query.to).toBe('2026-07-15T12:00:00.000Z');
    expect(query.from).toBe('2026-07-08T12:00:00.000Z');
    expect(query.regionId).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.groupBy).toEqual(['type']);
  });

  it('includes the filters that are set (severity coerced to a number)', () => {
    const query = buildReportQuery(
      { ...DEFAULT_REPORT_FORM, regionId: 'r1', severity: '3', status: 'active', compareYoY: true },
      NOW,
    );
    expect(query.regionId).toBe('r1');
    expect(query.severity).toBe(3);
    expect(query.status).toBe('active');
    expect(query.compareYoY).toBe(true);
  });
});

describe('queryToForm', () => {
  it('round-trips a query back into the form', () => {
    const form = {
      ...DEFAULT_REPORT_FORM,
      period: 'month' as const,
      regionId: 'r1',
      severity: '4',
    };
    const restored = queryToForm(buildReportQuery(form, NOW));
    expect(restored.period).toBe('month');
    expect(restored.regionId).toBe('r1');
    expect(restored.severity).toBe('4');
    expect(restored.groupBy).toEqual(form.groupBy);
  });
});

describe('presetForm', () => {
  it('daily summary groups by region for a single day', () => {
    const form = presetForm('daily');
    expect(form.period).toBe('day');
    expect(form.groupBy).toEqual(['region']);
  });

  it('year-over-year groups by month and enables the АППГ comparison', () => {
    const form = presetForm('yoy');
    expect(form.period).toBe('year');
    expect(form.groupBy).toEqual(['month']);
    expect(form.compareYoY).toBe(true);
  });
});
