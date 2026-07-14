import { describe, expect, it } from 'vitest';
import {
  createIncidentRuntimeImage,
  incidentClusterCountImageId,
  incidentStatusImageId,
} from './incident-symbols';

describe('incident runtime image ids', () => {
  it('builds stable data-driven status and cluster-count ids', () => {
    expect(incidentStatusImageId('localized', 4)).toBe('incident-status-localized-sev-4');
    expect(incidentClusterCountImageId(19)).toBe('incident-cluster-count-19');
  });

  it('ignores unrelated missing style images', () => {
    expect(createIncidentRuntimeImage('unrelated-sprite', () => '#000000')).toBeNull();
  });
});
