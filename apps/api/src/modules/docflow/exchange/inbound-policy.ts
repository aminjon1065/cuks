import type { InboundQuarantineReason } from '@cuks/shared';

/**
 * What an inbound exchange message is allowed to be, and what happens to it (plan этап 10:
 * «Payload size/type validation», «AV до регистрации входящего вложения», «Mapping external
 * correspondent/type в quarantined review queue»).
 *
 * Pure, because these rules decide whether untrusted bytes from outside the perimeter become
 * a registered document — and the cases worth being sure about (an executable renamed to
 * `.pdf`, a scan that has not finished, a sender nobody recognises) are far easier to state as
 * a table than to reproduce against a real transport.
 */

/**
 * MIME types an exchange message may carry — an ALLOW-list, not a deny-list.
 *
 * A deny-list of dangerous types is a losing position for an inbound channel: it has to be
 * right about every executable format that exists, forever, while the attacker only has to
 * find one it forgot. The set below is what official correspondence actually consists of.
 */
export const INBOUND_ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'text/plain',
] as const;

/** One letter cannot bring an archive's worth of files. */
export const INBOUND_MAX_ATTACHMENTS = 20;

export interface InboundPayload {
  subject: string;
  attachments: { fileName: string; contentType: string; size: number }[];
}

export type PayloadVerdict = { ok: true } | { ok: false; code: string; detail: string };

/**
 * Whether the message may be accepted at all. A refusal here is FINAL — the message is
 * rejected, not quarantined: an oversized or executable payload does not become acceptable
 * because a person looks at it, and offering a reviewer a button that would register a `.exe`
 * is offering them a mistake.
 */
export function validateInboundPayload(
  payload: InboundPayload,
  maxAttachmentBytes: number,
): PayloadVerdict {
  if (!payload.subject.trim()) {
    return { ok: false, code: 'exchange.no_subject', detail: 'Письмо без темы' };
  }
  if (payload.attachments.length > INBOUND_MAX_ATTACHMENTS) {
    return {
      ok: false,
      code: 'exchange.too_many_attachments',
      detail: `Вложений ${payload.attachments.length}, допустимо ${INBOUND_MAX_ATTACHMENTS}`,
    };
  }
  for (const attachment of payload.attachments) {
    if (attachment.size > maxAttachmentBytes) {
      return {
        ok: false,
        code: 'exchange.attachment_too_large',
        detail: `«${attachment.fileName}» превышает допустимый размер`,
      };
    }
    if (!(INBOUND_ALLOWED_MIME as readonly string[]).includes(attachment.contentType)) {
      return {
        ok: false,
        code: 'exchange.attachment_type_refused',
        detail: `Тип «${attachment.contentType}» не принимается`,
      };
    }
  }
  return { ok: true };
}

/** What the register knows about a message when it decides whether to promote it. */
export interface PromotionInputs {
  /** Antivirus verdicts of every attachment, in any order. */
  avStatuses: ('pending' | 'clean' | 'infected')[];
  /** Whether the sender was matched to a correspondent. */
  correspondentId: string | null;
  /** Whether a document type was recognised or chosen. */
  typeCode: string | null;
}

export type PromotionDecision =
  | { action: 'wait' }
  | { action: 'register' }
  | { action: 'quarantine'; reason: InboundQuarantineReason };

/**
 * Whether an accepted message may become a registered document yet.
 *
 * The order is the whole rule. Infection first, because an infected attachment is a refusal
 * and no amount of reference-data review changes that. Then the scan, because a document must
 * never be registered around bytes nobody has checked — «AV до регистрации входящего
 * вложения» is not «AV eventually». Only then the reference data, which is the one thing a
 * person can actually resolve.
 */
export function planPromotion(inputs: PromotionInputs): PromotionDecision {
  if (inputs.avStatuses.includes('infected')) {
    return { action: 'quarantine', reason: 'attachment_infected' };
  }
  if (inputs.avStatuses.includes('pending')) {
    // Not quarantine: nobody is being asked anything, the scanner simply has not finished.
    return { action: 'wait' };
  }
  if (!inputs.correspondentId) {
    return { action: 'quarantine', reason: 'correspondent_unmatched' };
  }
  if (!inputs.typeCode) {
    return { action: 'quarantine', reason: 'type_unmatched' };
  }
  return { action: 'register' };
}

/**
 * Match a stated sender against the correspondent list.
 *
 * Exact, case- and space-insensitive only. A fuzzy match here would be a machine quietly
 * deciding that «Хукумат г. Душанбе» and «Хукумат Душанбе» are the same organisation, and
 * filing an official letter under the wrong sender is worse than asking a person — which is
 * what the quarantine queue is for.
 */
export function matchCorrespondent(
  senderName: string | null,
  candidates: { id: string; name: string; shortName: string | null }[],
): string | null {
  if (!senderName) return null;
  const needle = normalise(senderName);
  if (!needle) return null;
  const hit = candidates.find(
    (c) => normalise(c.name) === needle || (c.shortName && normalise(c.shortName) === needle),
  );
  return hit?.id ?? null;
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
