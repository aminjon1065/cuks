import { describe, expect, it } from 'vitest';
import {
  correspondentsQuerySchema,
  createCorrespondentSchema,
  createJournalSchema,
  createNomenclatureSchema,
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

describe('correspondentsQuerySchema', () => {
  it('coerces activeOnly from a query string', () => {
    expect(correspondentsQuerySchema.parse({ activeOnly: 'true' }).activeOnly).toBe(true);
    expect(correspondentsQuerySchema.parse({ search: 'мчс' }).search).toBe('мчс');
  });
});
