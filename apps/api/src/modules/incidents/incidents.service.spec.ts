import { describe, expect, it } from 'vitest';
import {
  isSelectableIncidentType,
  mergeReportSnapshot,
  nextIncidentNumber,
} from './incidents.service';

describe('incident registry business rules', () => {
  it('creates a per-year padded human incident number', () => {
    expect(nextIncidentNumber(2026, 0)).toBe('ЧС-2026-0001');
    expect(nextIncidentNumber(2026, 41)).toBe('ЧС-2026-0042');
  });

  it('carries forward every unmodified report figure into the immutable snapshot', () => {
    const snapshot = mergeReportSnapshot(
      {
        dead: 1,
        injured: 2,
        evacuated: 3,
        affected: 4,
        damageEst: '1200.50',
        damageNote: 'Initial estimate',
      },
      { text: 'Updated casualties', injured: 5 },
    );

    expect(snapshot).toEqual({
      dead: 1,
      injured: 5,
      evacuated: 3,
      affected: 4,
      damageEst: '1200.50',
      damageNote: 'Initial estimate',
    });
  });

  it('accepts active leaf types and rejects a category with child types', () => {
    expect(isSelectableIncidentType({ code: 'nat.hydro.flood' }, undefined)).toBe(true);
    expect(isSelectableIncidentType({ code: 'nat.hydro' }, { code: 'nat.hydro.flood' })).toBe(
      false,
    );
    expect(isSelectableIncidentType(undefined, undefined)).toBe(false);
  });
});
