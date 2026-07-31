import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CornerUpLeft } from 'lucide-react';
import type { DocumentDetailDto } from '@cuks/shared';
import { useDocumentLinks } from '../api/queries';

/**
 * The answer↔letter relation, shown on both cards above the tabs (docs/modules/11 §12.3).
 *
 * Read off the links resource rather than a second query: the `reply` link is one row, and
 * whether this card is the answer or the letter follows from which side of it we are on.
 * Only the number is shown — a linked card's subject may be ДСП to whoever is looking.
 */
export function RelationBanner({ doc }: { doc: DocumentDetailDto }): React.JSX.Element | null {
  const { t } = useTranslation('docflow');
  const links = useDocumentLinks(doc.id);
  const reply = (links.data ?? []).find((l) => l.kind === 'reply');
  if (!reply) return null;

  // An outgoing card is the answer; anything else is the letter being answered.
  const isAnswer = doc.docClass === 'outgoing';
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2 text-[13px] text-text">
      <CornerUpLeft className="size-4 shrink-0 text-text-muted" aria-hidden />
      <span className="text-text-muted">
        {isAnswer ? t('response.banner.answerTo') : t('response.banner.answeredBy')}
      </span>
      <Link to={`/app/docs/${reply.documentId}`} className="text-primary hover:underline">
        {reply.regNumber ?? t('response.banner.draft')}
      </Link>
    </div>
  );
}
