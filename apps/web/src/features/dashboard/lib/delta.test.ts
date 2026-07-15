import { describe, expect, it } from 'vitest';
import { computeKpiDelta } from './delta';

describe('computeKpiDelta', () => {
  it('treats a rise as danger (every summary metric is "higher is worse")', () => {
    expect(computeKpiDelta(12, 10)).toEqual({ text: '+20%', direction: 'up', tone: 'danger' });
  });

  it('treats a fall as success with a minus-signed percent', () => {
    expect(computeKpiDelta(8, 10)).toEqual({ text: '−20%', direction: 'down', tone: 'success' });
  });

  it('is neutral when unchanged', () => {
    expect(computeKpiDelta(5, 5)).toEqual({ text: '0', direction: 'flat', tone: 'neutral' });
  });

  it('shows the absolute rise when there is no previous baseline', () => {
    expect(computeKpiDelta(7, 0)).toEqual({ text: '+7', direction: 'up', tone: 'danger' });
  });

  it('reads a sub-percent change as <1%', () => {
    expect(computeKpiDelta(301, 300)).toEqual({ text: '+<1%', direction: 'up', tone: 'danger' });
  });
});
