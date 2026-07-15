import { describe, expect, it } from 'vitest';
import { documentTransitionAllowed } from '../enums/index';
import {
  correspondentsQuerySchema,
  createCorrespondentSchema,
  createDocumentSchema,
  createJournalSchema,
  createNomenclatureSchema,
  registerDocumentSchema,
} from './docflow';

describe('createJournalSchema', () => {
  const base = {
    code: 'orders',
    name: 'Приказы',
    docClass: 'internal',
    numberTemplate: '{П}-{YYYY}/{seq4}',
  };

  it('accepts a valid journal and defaults seqReset to yearly', () => {
    const parsed = createJournalSchema.parse(base);
    expect(parsed.seqReset).toBe('yearly');
    expect(parsed.docClass).toBe('internal');
  });

  it('requires a {seqN} token in the number template', () => {
    expect(createJournalSchema.safeParse({ ...base, numberTemplate: '{П}-{YYYY}' }).success).toBe(
      false,
    );
    expect(
      createJournalSchema.safeParse({ ...base, numberTemplate: '{П}-{YYYY}/{seq4}' }).success,
    ).toBe(true);
  });

  it('rejects a code with disallowed characters', () => {
    expect(createJournalSchema.safeParse({ ...base, code: 'плохой код' }).success).toBe(false);
    expect(createJournalSchema.safeParse({ ...base, code: 'in_2' }).success).toBe(true);
  });

  it('rejects an unknown doc class', () => {
    expect(createJournalSchema.safeParse({ ...base, docClass: 'other' }).success).toBe(false);
  });
});

describe('createNomenclatureSchema', () => {
  it('requires a non-empty index and title', () => {
    expect(createNomenclatureSchema.safeParse({ index: '01-01', title: 'Приказы' }).success).toBe(
      true,
    );
    expect(createNomenclatureSchema.safeParse({ index: '', title: 'x' }).success).toBe(false);
    expect(createNomenclatureSchema.safeParse({ index: '01-01', title: '' }).success).toBe(false);
  });
});

describe('createCorrespondentSchema', () => {
  it('accepts a name-only correspondent (other fields optional/nullable)', () => {
    expect(createCorrespondentSchema.safeParse({ name: 'МЧС РТ' }).success).toBe(true);
    expect(
      createCorrespondentSchema.safeParse({ name: 'МЧС', shortName: null, email: null }).success,
    ).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(createCorrespondentSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('createDocumentSchema', () => {
  const base = { docClass: 'internal', typeCode: 'order', subject: 'О мерах' };

  it('accepts a minimal draft and defaults confidentiality to normal', () => {
    const parsed = createDocumentSchema.parse(base);
    expect(parsed.confidentiality).toBe('normal');
  });

  it('requires a non-empty subject and a known doc class', () => {
    expect(createDocumentSchema.safeParse({ ...base, subject: '' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ ...base, docClass: 'nope' }).success).toBe(false);
  });

  it('validates the access list as uuids', () => {
    expect(createDocumentSchema.safeParse({ ...base, accessList: ['not-a-uuid'] }).success).toBe(
      false,
    );
  });
});

describe('registerDocumentSchema', () => {
  it('requires a journal uuid', () => {
    expect(registerDocumentSchema.safeParse({ journalId: 'x' }).success).toBe(false);
    expect(
      registerDocumentSchema.safeParse({ journalId: '0190a000-0000-7000-8000-000000000001' })
        .success,
    ).toBe(true);
  });
});

describe('documentTransitionAllowed', () => {
  it('permits the forward lifecycle and the rework back-edges', () => {
    expect(documentTransitionAllowed('draft', 'on_route')).toBe(true);
    expect(documentTransitionAllowed('on_route', 'pending_registration')).toBe(true);
    expect(documentTransitionAllowed('registered', 'in_progress')).toBe(true);
    expect(documentTransitionAllowed('rejected', 'draft')).toBe(true);
  });

  it('never allows a manual change into "registered" (that is the register action only)', () => {
    expect(documentTransitionAllowed('draft', 'registered')).toBe(false);
    expect(documentTransitionAllowed('pending_registration', 'registered')).toBe(false);
  });

  it('rejects skips and moves out of a terminal state', () => {
    expect(documentTransitionAllowed('draft', 'completed')).toBe(false);
    expect(documentTransitionAllowed('archived', 'in_progress')).toBe(false);
    expect(documentTransitionAllowed('registered', 'draft')).toBe(false);
  });
});

describe('correspondentsQuerySchema', () => {
  it('parses activeOnly from a query string without the coerce footgun', () => {
    expect(correspondentsQuerySchema.parse({ activeOnly: 'true' }).activeOnly).toBe(true);
    // z.coerce.boolean would turn the string "false" into true — this must be false.
    expect(correspondentsQuerySchema.parse({ activeOnly: 'false' }).activeOnly).toBe(false);
    expect(correspondentsQuerySchema.parse({}).activeOnly).toBeUndefined();
    expect(correspondentsQuerySchema.parse({ search: 'мчс' }).search).toBe('мчс');
  });
});
