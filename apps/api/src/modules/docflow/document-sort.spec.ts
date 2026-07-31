import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { DOCUMENT_SORT_FIELDS } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { DOCUMENT_TIE_BREAKER, documentOrderBy, parseDocumentSort } from './document-sort';

/**
 * The allow-list the plan asks for by name (§12.1). Two things are being tested: that a column
 * name from the client can never become SQL by itself, and that every list ends in a unique
 * tie-breaker — without one, «страница 2» of a register is not a promise about anything.
 */
describe('parseDocumentSort', () => {
  it('reads the -field convention both ways', () => {
    expect(parseDocumentSort('subject')).toEqual({ field: 'subject', descending: false });
    expect(parseDocumentSort('-reg_date')).toEqual({ field: 'reg_date', descending: true });
  });

  it('is null when nothing was asked for, so the caller applies its own default', () => {
    expect(parseDocumentSort(undefined)).toBeNull();
    expect(parseDocumentSort('')).toBeNull();
  });

  it('refuses anything outside the list, including SQL dressed as a column', () => {
    for (const bad of [
      'password',
      'documents.access_list',
      'created_at; drop table app.documents',
      'created_at desc, (select 1)',
      '(case when 1=1 then subject end)',
      'CREATED_AT',
      '--',
    ]) {
      expect(() => parseDocumentSort(bad), bad).toThrow(AppException);
    }
  });

  it('admits every field the DTO admits — the two lists must not drift apart', () => {
    for (const field of DOCUMENT_SORT_FIELDS) {
      expect(parseDocumentSort(field)?.field).toBe(field);
    }
  });
});

describe('documentOrderBy', () => {
  it('always ends in the id tie-breaker, whatever was asked for', () => {
    for (const raw of [undefined, 'subject', '-reg_date', 'status', 'reg_number', '-due_date']) {
      const order = documentOrderBy(parseDocumentSort(raw));
      expect(order.length, raw ?? 'default').toBeGreaterThanOrEqual(2);
      expect(order[order.length - 1], raw ?? 'default').toBe(DOCUMENT_TIE_BREAKER);
    }
  });

  it('refuses relevance when there is no query to be relevant to', () => {
    expect(() => documentOrderBy({ field: 'relevance', descending: true })).toThrow(AppException);
  });

  it('accepts relevance when the search hands it the expression', () => {
    expect(() => documentOrderBy({ field: 'relevance', descending: true }, sql`1`)).not.toThrow();
  });
});
