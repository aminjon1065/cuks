import { describe, expect, it } from 'vitest';
import {
  INBOUND_MAX_ATTACHMENTS,
  matchCorrespondent,
  planPromotion,
  validateInboundPayload,
} from './inbound-policy';

const MAX = 1000;
const pdf = { fileName: 'letter.pdf', contentType: 'application/pdf', size: 100 };

describe('validateInboundPayload', () => {
  it('accepts an ordinary letter', () => {
    expect(validateInboundPayload({ subject: 'О мерах', attachments: [pdf] }, MAX).ok).toBe(true);
  });

  it('refuses a letter with no subject — there is no document in it', () => {
    const v = validateInboundPayload({ subject: '  ', attachments: [] }, MAX);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('exchange.no_subject');
  });

  it('refuses an executable however it is named', () => {
    // The allow-list is the point: a deny-list has to be right about every dangerous format
    // forever, while an attacker needs one it forgot.
    for (const contentType of [
      'application/x-msdownload',
      'application/x-sh',
      'application/octet-stream',
      'text/html',
      'image/svg+xml',
    ]) {
      const v = validateInboundPayload(
        { subject: 'Письмо', attachments: [{ ...pdf, contentType }] },
        MAX,
      );
      expect(v.ok, contentType).toBe(false);
      if (!v.ok) expect(v.code).toBe('exchange.attachment_type_refused');
    }
  });

  it('refuses an oversized attachment', () => {
    const v = validateInboundPayload(
      { subject: 'Письмо', attachments: [{ ...pdf, size: MAX + 1 }] },
      MAX,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('exchange.attachment_too_large');
  });

  it('refuses an archive of files pretending to be one letter', () => {
    const many = Array.from({ length: INBOUND_MAX_ATTACHMENTS + 1 }, () => pdf);
    const v = validateInboundPayload({ subject: 'Письмо', attachments: many }, MAX);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('exchange.too_many_attachments');
  });
});

describe('planPromotion', () => {
  const ready = { avStatuses: ['clean' as const], correspondentId: 'c1', typeCode: 'letter' };

  it('registers only when everything holds', () => {
    expect(planPromotion(ready)).toEqual({ action: 'register' });
  });

  it('waits while the scanner is still working — nobody is being asked anything', () => {
    expect(planPromotion({ ...ready, avStatuses: ['clean', 'pending'] })).toEqual({
      action: 'wait',
    });
  });

  it('quarantines an infected attachment ahead of every other question', () => {
    // Even with the reference data unresolved: an infected file is not a mapping problem, and
    // asking a reviewer about the sender first would bury the thing that matters.
    expect(
      planPromotion({ avStatuses: ['infected'], correspondentId: null, typeCode: null }),
    ).toEqual({ action: 'quarantine', reason: 'attachment_infected' });
  });

  it('never registers around an unscanned attachment', () => {
    // «AV до регистрации входящего вложения» is not «AV eventually»: the pending case must not
    // fall through to `register` under any combination of the other inputs.
    for (const correspondentId of ['c1', null]) {
      for (const typeCode of ['letter', null]) {
        const decision = planPromotion({ avStatuses: ['pending'], correspondentId, typeCode });
        expect(decision.action).not.toBe('register');
      }
    }
  });

  it('asks a person about an unknown sender, then about an unknown type', () => {
    expect(planPromotion({ ...ready, correspondentId: null })).toEqual({
      action: 'quarantine',
      reason: 'correspondent_unmatched',
    });
    expect(planPromotion({ ...ready, typeCode: null })).toEqual({
      action: 'quarantine',
      reason: 'type_unmatched',
    });
  });

  it('treats a letter with no attachments as scanned', () => {
    expect(planPromotion({ ...ready, avStatuses: [] })).toEqual({ action: 'register' });
  });
});

describe('matchCorrespondent', () => {
  const list = [
    { id: 'c1', name: 'Хукумат г. Душанбе', shortName: 'Хукумат Душанбе' },
    { id: 'c2', name: 'Министерство финансов', shortName: null },
  ];

  it('matches on the full name, ignoring case and spacing', () => {
    expect(matchCorrespondent('  хукумат  г. душанбе ', list)).toBe('c1');
  });

  it('matches on the short name too', () => {
    expect(matchCorrespondent('Хукумат Душанбе', list)).toBe('c1');
  });

  it('does NOT guess — a near miss goes to a person', () => {
    // Filing an official letter under the wrong sender is worse than asking; the quarantine
    // queue exists precisely so the machine never has to guess this.
    expect(matchCorrespondent('Хукумат Душанбе г.', list)).toBeNull();
    expect(matchCorrespondent('Минфин', list)).toBeNull();
  });

  it('returns null for an absent or empty sender', () => {
    expect(matchCorrespondent(null, list)).toBeNull();
    expect(matchCorrespondent('   ', list)).toBeNull();
  });
});
