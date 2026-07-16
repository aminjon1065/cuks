import { describe, expect, it } from 'vitest';
import type { ReactionSummaryDto } from '@cuks/shared';
import { toggleReactionChip } from '../api/queries';

describe('toggleReactionChip — optimistic reaction flip (docs/modules/13 §4)', () => {
  it('adds a new chip as mine with count 1', () => {
    expect(toggleReactionChip([], '👍')).toEqual([{ emoji: '👍', count: 1, mine: true }]);
  });

  it('increments an existing chip I had not reacted to', () => {
    const before: ReactionSummaryDto[] = [{ emoji: '👍', count: 2, mine: false }];
    expect(toggleReactionChip(before, '👍')).toEqual([{ emoji: '👍', count: 3, mine: true }]);
  });

  it('decrements and drops the chip when I remove my only reaction', () => {
    const before: ReactionSummaryDto[] = [{ emoji: '👍', count: 1, mine: true }];
    expect(toggleReactionChip(before, '👍')).toEqual([]);
  });

  it('decrements but keeps the chip when others still reacted', () => {
    const before: ReactionSummaryDto[] = [{ emoji: '👍', count: 3, mine: true }];
    expect(toggleReactionChip(before, '👍')).toEqual([{ emoji: '👍', count: 2, mine: false }]);
  });

  it('leaves other emojis untouched', () => {
    const before: ReactionSummaryDto[] = [
      { emoji: '👍', count: 1, mine: false },
      { emoji: '🔥', count: 2, mine: true },
    ];
    expect(toggleReactionChip(before, '👍')).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '🔥', count: 2, mine: true },
    ]);
  });
});
