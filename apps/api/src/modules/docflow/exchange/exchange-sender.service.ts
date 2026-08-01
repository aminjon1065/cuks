import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { documentDispatches, documents, type Database } from '@cuks/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DB } from '../../../common/db/db.module';
import { ConfigService } from '../../../config/config.service';
import { DocflowFilesService } from '../docflow-files.service';
import { ExchangeRegistryService } from './exchange-registry.service';
import { planRetry } from './exchange-retry-policy';
import type { OutboundAttachment } from './document-exchange-port';

/** How many due attempts one pass takes. Bounded so a backlog cannot monopolise the pool. */
const BATCH_SIZE = 10;

/**
 * The outbound sender (plan этап 10 «Outbox, retries, exponential backoff, dead-letter»).
 *
 * **The dispatch row IS the outbox entry.** A pending machine attempt whose `next_attempt_at`
 * has come is exactly «что осталось отправить»; a separate outbox table would be a second
 * place where the same fact lives, and the two would eventually disagree about whether a
 * letter went out — which is the one disagreement a chancellery cannot tolerate.
 *
 * Claimed with `FOR UPDATE SKIP LOCKED`, so two api instances never send the same letter
 * twice. The claim is committed BEFORE the adapter is called: a transport that hangs must not
 * hold a database transaction open, and a crash mid-send must leave the attempt claimed rather
 * than free for another instance to send again. The cost of that choice is that a crash after
 * the transport accepted but before the row was updated leaves an attempt that will be retried
 * — a duplicate the recipient may notice. That is the right side to fail on: a letter sent
 * twice is an embarrassment, a letter silently not sent is a missed deadline.
 */
@Injectable()
export class ExchangeSenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExchangeSenderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: ExchangeRegistryService,
    private readonly files: DocflowFilesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.registry.isConfigured) return;
    const seconds = this.config.get('DOCFLOW_EXCHANGE_POLL_SECONDS');
    this.timer = setInterval(() => void this.sendDue(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: claim what is due, hand each to its adapter, record the outcome. */
  async sendDue(): Promise<{ sent: number; failed: number }> {
    if (this.running || !this.registry.isConfigured) return { sent: 0, failed: 0 };
    this.running = true;
    const now = new Date();
    const result = { sent: 0, failed: 0 };
    try {
      const claimed = await this.claim(now);
      for (const row of claimed) {
        const outcome = await this.deliver(row, now);
        if (outcome) result.sent += 1;
        else result.failed += 1;
      }
    } catch (error) {
      // A failing pass must not take the api down: the next tick tries again, and the attempts
      // it did not reach are still claimed-and-due, not lost.
      this.logger.error({ error }, 'exchange sender pass failed');
    } finally {
      this.running = false;
    }
    return result;
  }

  /**
   * Take the due attempts and mark them in flight in one transaction, so the adapter call
   * happens outside it. `next_attempt_at = null` is the in-flight marker: the row stays
   * `pending` (it has not settled) but is no longer due, so a second pass skips it.
   */
  private async claim(now: Date): Promise<ClaimedDispatch[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: documentDispatches.id,
          documentId: documentDispatches.documentId,
          channel: documentDispatches.channel,
          attemptNo: documentDispatches.attemptNo,
          recipientName: documentDispatches.recipientName,
          recipientAddress: documentDispatches.recipientAddress,
          regNumber: documents.regNumber,
          subject: documents.subject,
        })
        .from(documentDispatches)
        .innerJoin(documents, eq(documents.id, documentDispatches.documentId))
        .where(
          and(
            eq(documentDispatches.status, 'pending'),
            isNotNull(documentDispatches.nextAttemptAt),
            lte(documentDispatches.nextAttemptAt, now),
            isNull(documentDispatches.deletedAt),
            // A document withdrawn from the register stops being sent.
            isNull(documents.deletedAt),
            ne(documents.status, 'rejected'),
          ),
        )
        .orderBy(asc(documentDispatches.nextAttemptAt))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true, of: documentDispatches });

      if (rows.length > 0) {
        await tx
          .update(documentDispatches)
          .set({ nextAttemptAt: null, attemptedAt: now, updatedAt: now })
          .where(sql`${documentDispatches.id} in ${rows.map((r) => r.id)}`);
      }
      return rows;
    });
  }

  private async deliver(row: ClaimedDispatch, now: Date): Promise<boolean> {
    const adapter = this.registry.get(row.channel);
    if (!adapter) {
      // The adapter was configured when the attempt was created and is gone now — a
      // deployment change, not a transport fault. Hand it to a human rather than loop.
      await this.recordFailure(row, now, 'exchange.adapter_missing', 'Адаптер канала не настроен', {
        retryable: false,
        failureCode: 'exchange.adapter_missing',
      });
      return false;
    }

    let attachments: OutboundAttachment[];
    try {
      attachments = await this.resolveAttachments(row.documentId);
    } catch (error) {
      // Resolution failing means the document's own files are not servable — an infected or
      // unscanned attachment, most likely. Never retried: the file will not become clean by
      // being asked for again, and sending a document without its body is worse than not
      // sending it.
      await this.recordFailure(
        row,
        now,
        'exchange.attachments_unavailable',
        String(error).slice(0, 300),
        { retryable: false, failureCode: 'exchange.attachments_unavailable' },
      );
      return false;
    }

    const sendResult = await adapter
      .send({
        dispatchId: row.id,
        documentId: row.documentId,
        regNumber: row.regNumber,
        subject: row.subject,
        recipientName: row.recipientName,
        recipientAddress: row.recipientAddress,
        attachments,
      })
      .catch(
        (error: unknown) =>
          ({
            ok: false,
            retryable: true,
            failureCode: 'exchange.adapter_threw',
            detail: String(error).slice(0, 300),
          }) as const,
      );

    if (!sendResult.ok) {
      await this.recordFailure(row, now, sendResult.failureCode, sendResult.detail, sendResult);
      return false;
    }

    await this.db
      .update(documentDispatches)
      .set({
        status: 'sent',
        sentAt: now,
        adapterId: adapter.id,
        externalReference: sendResult.externalReference,
        failureCode: null,
        failureMessage: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      // Still guarded on `pending`: an operator may have cancelled the attempt while the
      // transport was working, and a cancelled letter must not become «sent».
      .where(and(eq(documentDispatches.id, row.id), eq(documentDispatches.status, 'pending')));

    await this.audit.logAndWait({
      action: 'docflow.exchange.sent',
      actorId: null,
      entityType: 'document',
      entityId: row.documentId,
      meta: {
        dispatchId: row.id,
        channel: row.channel,
        adapterId: adapter.id,
        attemptNo: row.attemptNo,
        // The adapter's own reference, never its configuration.
        reference: sendResult.externalReference ?? '',
      },
    });
    return true;
  }

  /** Apply the retry policy and write the result — a schedule, or a dead letter. */
  private async recordFailure(
    row: ClaimedDispatch,
    now: Date,
    failureCode: string,
    detail: string,
    outcome: { retryable: boolean; failureCode: string },
  ): Promise<void> {
    const plan = planRetry(
      row.attemptNo,
      this.config.get('DOCFLOW_EXCHANGE_MAX_ATTEMPTS'),
      outcome,
      now,
    );
    const deadLettered = plan.action === 'dead_letter';
    await this.db
      .update(documentDispatches)
      .set({
        // A dead letter is a settled failure the operator owns; a scheduled retry is still
        // pending, because the machine has not finished with it.
        status: deadLettered ? 'failed' : 'pending',
        failureCode,
        failureMessage: detail.slice(0, 500),
        nextAttemptAt: plan.nextAttemptAt,
        deadLetteredAt: deadLettered ? now : null,
        updatedAt: now,
      })
      .where(and(eq(documentDispatches.id, row.id), eq(documentDispatches.status, 'pending')));

    await this.audit.logAndWait({
      action: deadLettered ? 'docflow.exchange.dead_lettered' : 'docflow.exchange.retry_scheduled',
      actorId: null,
      entityType: 'document',
      entityId: row.documentId,
      meta: {
        dispatchId: row.id,
        channel: row.channel,
        attemptNo: row.attemptNo,
        failureCode,
        reason: plan.reason,
      },
    });
    this.logger.warn(
      `dispatch ${row.id} attempt ${row.attemptNo} failed (${failureCode}); ${plan.reason}`,
    );
  }

  /**
   * The document's current files, as bytes. Goes through the docflow file gate, so an
   * unscanned or infected attachment refuses here rather than leaving the building.
   */
  private async resolveAttachments(documentId: string): Promise<OutboundAttachment[]> {
    return this.files.resolveOutboundAttachments(documentId);
  }
}

interface ClaimedDispatch {
  id: string;
  documentId: string;
  channel: 'courier' | 'postal' | 'email' | 'integration' | 'hand_delivery' | 'other';
  attemptNo: number;
  recipientName: string;
  recipientAddress: string | null;
  regNumber: string | null;
  subject: string;
}
