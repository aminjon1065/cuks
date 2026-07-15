import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { journalCounters, type Database } from '@cuks/db';
import type { JournalSeqReset } from '@cuks/shared';

/**
 * Registration numbering (docs/modules/11 §3). Each journal owns a per-year (or
 * continuous) counter in `app.journal_counters`; a number is minted by atomically
 * incrementing it. The gap-free / duplicate-free guarantee comes from the unique
 * `(journal_id, year)` index plus `INSERT … ON CONFLICT DO UPDATE … RETURNING`,
 * whose row lock serialises concurrent registrations — and because allocation runs
 * inside the caller's transaction, a rolled-back registration also rolls back the
 * increment, so no number is ever burned. No separate advisory lock is needed (the
 * counter table makes the incident-style `max()+lock` idiom unnecessary here).
 */
@Injectable()
export class DocflowNumberingService {
  /**
   * Mint the next registration number for a journal, within the caller's tx.
   * `seqReset: 'never'` keeps a single continuous book (bucketed under year 0).
   */
  async allocate(
    tx: Database,
    journal: { id: string; numberTemplate: string; seqReset: JournalSeqReset },
    now: Date,
  ): Promise<{ number: string; year: number; seq: number }> {
    const year = now.getUTCFullYear();
    const bucket = journal.seqReset === 'never' ? 0 : year;
    const [row] = await tx
      .insert(journalCounters)
      .values({ journalId: journal.id, year: bucket, lastSeq: 1 })
      .onConflictDoUpdate({
        target: [journalCounters.journalId, journalCounters.year],
        set: { lastSeq: sql`${journalCounters.lastSeq} + 1`, updatedAt: now },
      })
      .returning({ lastSeq: journalCounters.lastSeq });
    const seq = row?.lastSeq ?? 1;
    return {
      number: formatRegNumber(journal.numberTemplate, { year, month: now.getUTCMonth() + 1, seq }),
      year: bucket,
      seq,
    };
  }
}

/**
 * Render a registration-number template (docs/modules/11 §3). Tokens:
 * `{YYYY}`/`{YY}` year, `{MM}` zero-padded month, `{seqN}` the sequence padded to N
 * digits. Any other `{X}` is emitted as its literal inner text (so `{П}` → `П`).
 * Pure — unit-tested and safe to preview on the client.
 */
export function formatRegNumber(
  template: string,
  parts: { year: number; month: number; seq: number },
): string {
  return template.replace(/\{([^}]*)\}/g, (_match, token: string) => {
    if (token === 'YYYY') return String(parts.year);
    if (token === 'YY') return String(parts.year % 100).padStart(2, '0');
    if (token === 'MM') return String(parts.month).padStart(2, '0');
    const seqMatch = /^seq(\d+)$/.exec(token);
    if (seqMatch) return String(parts.seq).padStart(Number(seqMatch[1]), '0');
    // Anything else in braces is a literal prefix (e.g. `{П}` → `П`).
    return token;
  });
}
