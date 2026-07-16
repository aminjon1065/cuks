import { describe, expect, it } from 'vitest';
import { chatChannels, chatMembers, orgUnits, userPositions } from '@cuks/db';
import { OrgChannelsService } from './org-channels.service';

const UNIT = '01900000-0000-7000-8000-000000000001';
const CHANNEL = '01900000-0000-7000-8000-0000000000c0';
const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const C = '01900000-0000-7000-8000-00000000000c';

/**
 * A thenable, chainable db stub: reads resolve to rows keyed on the `from` table; writes record their
 * arguments. Lets us assert the add/remove diff of the org-channel membership reconciliation.
 */
function makeDb(staff: string[], current: string[]) {
  const inserted: string[][] = [];
  const deleted: string[] = [];

  const reader = () => {
    let table: unknown = null;
    const rowsFor = (): unknown[] => {
      if (table === orgUnits) return [{ id: UNIT, name: 'Отдел' }];
      if (table === chatChannels) return [{ id: CHANNEL }];
      if (table === userPositions) return staff.map((userId) => ({ userId }));
      if (table === chatMembers) return current.map((userId) => ({ userId }));
      return [];
    };
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown[]) => void) => resolve(rowsFor()),
    };
    return chain;
  };

  const db = {
    select: reader,
    selectDistinct: reader,
    insert: () => ({
      values(v: { userId: string }[]) {
        inserted.push(v.map((r) => r.userId));
        return { onConflictDoNothing: () => Promise.resolve(undefined) };
      },
    }),
    delete: () => ({
      where(clause: { ids?: string[] }) {
        deleted.push('members');
        void clause;
        return Promise.resolve(undefined);
      },
    }),
  };
  const service = new OrgChannelsService(db as never);
  return { service, inserted, deleted };
}

describe('OrgChannelsService.syncOrgUnit — membership reconciliation (docs/modules/13 §2)', () => {
  it('adds staff who are not yet members', async () => {
    const c = makeDb([A, B], [A]);
    await c.service.syncOrgUnit(UNIT);
    expect(c.inserted).toHaveLength(1);
    expect(c.inserted[0]).toEqual([B]);
    expect(c.deleted).toHaveLength(0);
  });

  it('removes members who left the unit', async () => {
    const c = makeDb([A], [A, C]);
    await c.service.syncOrgUnit(UNIT);
    expect(c.inserted).toHaveLength(0);
    expect(c.deleted).toHaveLength(1); // C removed
  });

  it('is a no-op when membership already matches', async () => {
    const c = makeDb([A], [A]);
    await c.service.syncOrgUnit(UNIT);
    expect(c.inserted).toHaveLength(0);
    expect(c.deleted).toHaveLength(0);
  });
});
