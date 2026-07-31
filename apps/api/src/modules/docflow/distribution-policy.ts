import type { DistributionTargetInput, DocClass, DocumentStatus } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Who a distribution reaches, and when a document may be distributed at all
 * (docs/modules/11 §12.4, plan этап 7). Pure, so the expansion rules are unit-tested
 * without a database and the service only supplies the rows it read.
 */

/** The document facts the distribution policy reads. */
export interface DistributableDocument {
  docClass: DocClass;
  status: DocumentStatus;
  regNumber: string | null;
}

/**
 * An internal document is distributed once it is registered (plan этап 7 приёмка: шаблон →
 * согласование → подпись → регистрация → ознакомление).
 *
 * The number is the point: an order people are told to acknowledge must be citable, and a
 * draft is still the author's to rewrite — readers would be acknowledging a text that can
 * change under them. Incoming and outgoing documents are not distributed: the first arrived
 * from outside, the second leaves through `document_dispatches`.
 */
export function assertDocumentDistributable(doc: DistributableDocument): void {
  if (doc.docClass !== 'internal') {
    throw AppException.unprocessable(
      'docflow.distribution.not_internal',
      'Only an internal document is distributed for acknowledgement',
      { docClass: doc.docClass },
    );
  }
  if (!doc.regNumber) {
    throw AppException.unprocessable(
      'docflow.distribution.not_registered',
      'The document must be registered before it is distributed',
      { status: doc.status },
    );
  }
  if (doc.status === 'archived') {
    throw AppException.conflict(
      'docflow.distribution.document_archived',
      'An archived document is not distributed',
    );
  }
}

/** One resolved reader, with the target that brought them in (for the audit trail). */
export interface ResolvedReader {
  userId: string;
  /** Which target first reached this person — a later duplicate does not overwrite it. */
  viaType: DistributionTargetInput['type'];
  viaId: string;
}

/**
 * Fold the per-target expansions into the reader list.
 *
 * Deduplicated by user: a person who is both named directly and sits in a targeted
 * subdivision owes ONE reading, not two — and the unique index would refuse the second row
 * anyway. The first target that reaches them is remembered, so «почему я в списке» has an
 * answer that does not change with the order of the query results.
 *
 * The result is a SNAPSHOT: whoever is hired into the subdivision tomorrow is not added to
 * a distribution that went out today. An order is addressed to the people who were there
 * when it was issued; retroactively adding readers would silently make yesterday's sheet
 * incomplete.
 */
export function foldReaders(
  expansions: readonly { target: DistributionTargetInput; userIds: readonly string[] }[],
): ResolvedReader[] {
  const seen = new Map<string, ResolvedReader>();
  for (const { target, userIds } of expansions) {
    for (const userId of userIds) {
      if (seen.has(userId)) continue;
      seen.set(userId, { userId, viaType: target.type, viaId: target.id });
    }
  }
  return [...seen.values()];
}

/**
 * A distribution that reaches nobody is refused rather than created empty: an order shown as
 * «распространён» with a sheet of zero readers is indistinguishable from one nobody has read
 * yet, and the difference matters to whoever answers for it.
 */
export function assertHasReaders(readers: readonly ResolvedReader[]): void {
  if (readers.length === 0) {
    throw AppException.unprocessable(
      'docflow.distribution.no_readers',
      'The chosen targets reach nobody',
    );
  }
}
