import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  correspondents,
  documentExchangeAttachments,
  documentExchangeInbound,
  fileVersions,
  fsNodes,
  type Database,
} from '@cuks/db';
import { DEFAULT_JOB_OPTIONS, QUEUE } from '@cuks/shared';
import { AuditService } from '../../../common/audit/audit.service';
import { DB } from '../../../common/db/db.module';
import { StorageService } from '../../../common/storage/storage.service';
import { ConfigService } from '../../../config/config.service';
import { ExchangeRegistryService } from './exchange-registry.service';
import { matchCorrespondent, validateInboundPayload } from './inbound-policy';
import type { DocumentExchangePort, InboundExchangeMessage } from './document-exchange-port';

/** Where an exchange attachment lands in object storage. Its own prefix, so it is obvious
 *  in a bucket listing that these bytes came from outside the perimeter. */
const KEY_PREFIX = 'exchange/inbound';

/**
 * The inbound receiver (plan этап 10).
 *
 * A message is NOT a document. It is stored as a message, its attachments go through the same
 * antivirus pipeline as any upload, and only when everything checks out does a person or the
 * promoter turn it into a registered document. Registering first and checking afterwards would
 * put a registration number on what may turn out to be an infected file from an unknown
 * sender — and a number cannot be taken back.
 *
 * Deduplication is the database's job, not the adapter's: `(adapter_id, external_id)` is
 * unique and the insert is `onConflictDoNothing`. A transport that redelivers — restarted,
 * or because its acknowledge never arrived — inserts nothing the second time, which is the
 * whole of «повторная доставка не создаёт дубликат» and does not depend on an adapter
 * remembering anything across a restart.
 */
@Injectable()
export class ExchangeReceiverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExchangeReceiverService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: ExchangeRegistryService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE.avScan) private readonly avScan: Queue,
  ) {}

  onModuleInit(): void {
    if (!this.registry.isConfigured) return;
    const seconds = this.config.get('DOCFLOW_EXCHANGE_POLL_SECONDS');
    this.timer = setInterval(() => void this.receiveAll(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over every configured adapter. */
  async receiveAll(): Promise<{ accepted: number; duplicates: number; rejected: number }> {
    const total = { accepted: 0, duplicates: 0, rejected: 0 };
    if (this.running || !this.registry.isConfigured) return total;
    this.running = true;
    try {
      for (const adapter of this.registry.all) {
        const messages = await adapter.poll().catch((error: unknown) => {
          // An unreadable transport is a state, not a crash: the next pass tries again.
          this.logger.warn(`poll failed for ${adapter.id}: ${String(error).slice(0, 200)}`);
          return [] as InboundExchangeMessage[];
        });
        for (const message of messages) {
          const outcome = await this.receive(adapter, message);
          total[outcome] += 1;
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'exchange receiver pass failed');
    } finally {
      this.running = false;
    }
    return total;
  }

  private async receive(
    adapter: DocumentExchangePort,
    message: InboundExchangeMessage,
  ): Promise<'accepted' | 'duplicates' | 'rejected'> {
    // Cheapest check first: a message we already hold needs no validation, no storage writes
    // and no scan — only an acknowledge, in case that is what failed last time.
    const [existing] = await this.db
      .select({ id: documentExchangeInbound.id })
      .from(documentExchangeInbound)
      .where(
        and(
          eq(documentExchangeInbound.adapterId, adapter.id),
          eq(documentExchangeInbound.externalId, message.externalId),
        ),
      )
      .limit(1);
    if (existing) {
      await adapter.acknowledge(message.externalId, 'accepted');
      return 'duplicates';
    }

    const maxBytes = this.config.get('DOCFLOW_EXCHANGE_MAX_ATTACHMENT_MB') * 1024 * 1024;
    const verdict = validateInboundPayload(
      {
        subject: message.subject,
        attachments: message.attachments.map((a) => ({
          fileName: a.fileName,
          contentType: a.contentType,
          size: a.body.length,
        })),
      },
      maxBytes,
    );

    if (!verdict.ok) {
      // Recorded, not discarded: an operator must be able to see that something arrived and
      // why it was refused. Nothing is written to storage — refused bytes do not enter.
      await this.insertMessage(adapter, message, {
        status: 'rejected',
        rejectedReason: `${verdict.code}: ${verdict.detail}`,
      });
      await adapter.acknowledge(message.externalId, 'rejected');
      await this.audit.logAndWait({
        action: 'docflow.exchange.rejected',
        actorId: null,
        entityType: 'document_exchange',
        entityId: message.externalId,
        meta: { adapterId: adapter.id, code: verdict.code },
      });
      return 'rejected';
    }

    const correspondentId = await this.matchSender(message.senderName);
    const inboundId = await this.insertMessage(adapter, message, {
      status: 'received',
      correspondentId,
    });
    if (!inboundId) {
      // Somebody else inserted it between the check and the insert — the unique index did its
      // job. Treat it exactly like the duplicate it is.
      await adapter.acknowledge(message.externalId, 'accepted');
      return 'duplicates';
    }

    await this.storeAttachments(inboundId, message);
    await adapter.acknowledge(message.externalId, 'accepted');
    await this.audit.logAndWait({
      action: 'docflow.exchange.received',
      actorId: null,
      entityType: 'document_exchange',
      entityId: inboundId,
      meta: {
        adapterId: adapter.id,
        externalId: message.externalId,
        attachments: message.attachments.length,
        // Whether the sender was recognised, never the sender's contact details.
        senderMatched: correspondentId !== null,
      },
    });
    return 'accepted';
  }

  /** Insert the message row; returns null when the unique index refused it as a duplicate. */
  private async insertMessage(
    adapter: DocumentExchangePort,
    message: InboundExchangeMessage,
    extra: {
      status: 'received' | 'rejected';
      correspondentId?: string | null;
      rejectedReason?: string;
    },
  ): Promise<string | null> {
    const [row] = await this.db
      .insert(documentExchangeInbound)
      .values({
        adapterId: adapter.id,
        externalId: message.externalId,
        status: extra.status,
        subject: message.subject.slice(0, 500),
        summary: message.summary,
        senderName: message.senderName,
        senderContact: message.senderContact,
        sentAt: message.sentAt,
        correspondentId: extra.correspondentId ?? null,
        rejectedReason: extra.rejectedReason ?? null,
      })
      .onConflictDoNothing({
        target: [documentExchangeInbound.adapterId, documentExchangeInbound.externalId],
      })
      .returning({ id: documentExchangeInbound.id });
    return row?.id ?? null;
  }

  /**
   * Write the attachments into object storage as ordinary file versions, `pending` scan, and
   * queue them for the antivirus.
   *
   * They live in the SYSTEM space with no owner and are linked to the message, not to any
   * document: an attachment on a letter that never becomes a document must not be reachable
   * through any document. The scan is the same one every upload goes through — a second
   * scanner would eventually give a second verdict.
   */
  private async storeAttachments(
    inboundId: string,
    message: InboundExchangeMessage,
  ): Promise<void> {
    for (const attachment of message.attachments) {
      const nodeId = uuidv7();
      const key = `${KEY_PREFIX}/${inboundId}/${nodeId}`;
      await this.storage.putObjectBytes(key, attachment.body, attachment.contentType);

      await this.db.transaction(async (tx) => {
        await tx.insert(fsNodes).values({
          id: nodeId,
          kind: 'file',
          name: attachment.fileName,
          space: 'system',
          mime: attachment.contentType,
          sizeCached: attachment.body.length,
          path: nodeId,
        });
        const [version] = await tx
          .insert(fileVersions)
          .values({
            nodeId,
            version: 1,
            storageKey: key,
            size: attachment.body.length,
            mime: attachment.contentType,
            checksumSha256: createHash('sha256').update(attachment.body).digest('hex'),
            // `pending` is the default and the point: nothing may be registered around these
            // bytes until the scanner has spoken.
          })
          .returning({ id: fileVersions.id });
        await tx
          .update(fsNodes)
          .set({ currentVersionId: version?.id ?? null })
          .where(eq(fsNodes.id, nodeId));
        await tx.insert(documentExchangeAttachments).values({
          inboundId,
          fileId: nodeId,
          fileName: attachment.fileName,
        });
      });

      // Best-effort, exactly like the upload path: a queue hiccup must not lose the message,
      // and the daily retention sweep catches a version left `pending`.
      await this.avScan
        .add('scan', { versionId: nodeId, storageKey: key }, DEFAULT_JOB_OPTIONS)
        .catch((error: unknown) =>
          this.logger.warn(`could not queue av-scan for ${key}: ${String(error).slice(0, 200)}`),
        );
    }
  }

  /** Exact match against the live correspondent list; a near miss is a person's decision. */
  private async matchSender(senderName: string | null): Promise<string | null> {
    if (!senderName) return null;
    const rows = await this.db
      .select({
        id: correspondents.id,
        name: correspondents.name,
        shortName: correspondents.shortName,
      })
      .from(correspondents)
      .where(and(isNull(correspondents.deletedAt), eq(correspondents.isActive, true)));
    return matchCorrespondent(senderName, rows);
  }

  /** How many messages are waiting on a person — the admin badge. */
  async quarantinedCount(): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(documentExchangeInbound)
      .where(inArray(documentExchangeInbound.status, ['quarantined', 'received']));
    return row?.n ?? 0;
  }
}
