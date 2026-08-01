import type { DispatchChannel } from '@cuks/shared';

/**
 * The document exchange contract (plan этап 10).
 *
 * CUKS runs in an isolated network and connects to no external service by default. This port
 * is what an internal transport — a watched folder, a departmental HTTP endpoint, one day an
 * internal SMTP relay — plugs into, so the register never learns which one it is talking to.
 *
 * Two rules the port exists to enforce.
 *
 * **An adapter is a boundary, not a library.** Everything crossing it is plain data: no
 * database handles, no request context, no `AuthUser`. An adapter that could reach into the
 * register would be able to write documents without going through registration, visibility or
 * audit — and the whole point of the isolation is that a transport cannot.
 *
 * **An adapter may fail, and that is ordinary.** Every method returns a result rather than
 * throwing for the expected failures, because «внешняя система недоступна» is a state the
 * chancellery must SEE and retry, not an exception that takes the request down with it
 * (приёмка: «отказ внешней системы не ломает основной API»).
 */
export interface DocumentExchangePort {
  /** Stable identity of this adapter instance — goes into audit and into the outbox row. */
  readonly id: string;

  /** Which dispatch channel this adapter serves. One adapter per channel. */
  readonly channel: DispatchChannel;

  /** Human-readable name for the admin screen. Never contains a secret. */
  readonly title: string;

  /**
   * Whether the adapter can reach its transport right now. Called by the health screen and
   * before the first send of a batch — never on every message, because a probe that runs per
   * message turns one unreachable transport into a queue of timeouts.
   */
  probe(): Promise<ExchangeProbeResult>;

  /** Hand one outgoing message to the transport. */
  send(message: OutboundExchangeMessage): Promise<ExchangeSendResult>;

  /**
   * Take everything the transport has received since the last call. Returns messages, and the
   * caller decides what is a duplicate — an adapter must not have to remember what it already
   * delivered, because a restarted adapter would forget.
   */
  poll(): Promise<InboundExchangeMessage[]>;

  /**
   * Tell the adapter a polled message was accepted (or permanently rejected) so it may stop
   * offering it. Separate from `poll` on purpose: acknowledging before the register has
   * committed would lose the message on a crash.
   */
  acknowledge(externalId: string, outcome: 'accepted' | 'rejected'): Promise<void>;
}

/** What the health screen shows. `detail` is for a human and must carry no credential. */
export interface ExchangeProbeResult {
  reachable: boolean;
  detail: string;
}

/** One outgoing letter, as the transport needs it. Ids only — never a document row. */
export interface OutboundExchangeMessage {
  /** The dispatch attempt this message belongs to; the receipt is correlated back by it. */
  dispatchId: string;
  documentId: string;
  /** The registration number, which is what a recipient quotes back. */
  regNumber: string | null;
  subject: string;
  recipientName: string;
  recipientAddress: string | null;
  /** Files to send, already resolved and virus-checked by the caller. */
  attachments: OutboundAttachment[];
}

export interface OutboundAttachment {
  fileName: string;
  contentType: string;
  /** The bytes. Resolved by the caller so an adapter never touches storage or its keys. */
  body: Buffer;
}

/**
 * The outcome of one send. `retryable` is the field the whole retry policy turns on: a refused
 * address is not worth twenty attempts, and an unreachable transport is not worth giving up on
 * after one.
 */
export type ExchangeSendResult =
  | { ok: true; externalReference: string | null; receipt: ExchangeReceipt | null }
  | { ok: false; retryable: boolean; failureCode: string; detail: string };

/** A technical receipt — kept, per plan §6.8, «без секретов». */
export interface ExchangeReceipt {
  fileName: string;
  contentType: string;
  body: Buffer;
}

/** One incoming letter as the transport hands it over. */
export interface InboundExchangeMessage {
  /**
   * The transport's own identifier for this message — a Message-ID, a file name, a sequence
   * number. The register deduplicates on `(adapter, externalId)`, so it must be stable across
   * redelivery and unique within the adapter (приёмка: «повторная доставка не создаёт
   * дубликат»).
   */
  externalId: string;
  subject: string;
  /** Sender as the transport states it — matched against the correspondent list, not trusted. */
  senderName: string | null;
  senderContact: string | null;
  /** The date the sender put on the letter, if the transport carries one. */
  sentAt: Date | null;
  summary: string | null;
  attachments: InboundAttachment[];
}

export interface InboundAttachment {
  fileName: string;
  contentType: string;
  body: Buffer;
}

/** DI token — Nest cannot inject an interface. */
export const DOCUMENT_EXCHANGE_ADAPTERS = Symbol('DOCUMENT_EXCHANGE_ADAPTERS');
