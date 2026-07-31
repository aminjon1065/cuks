import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { EmptyState } from '@cuks/ui';
import type { DocumentContent, DocumentDetailDto } from '@cuks/shared';
import { useUpdateDocument } from '../api/queries';
import { DocumentContentEditor } from './DocumentContentEditor';

/**
 * The document's structured body on the card (docs/modules/11 §12.7). Editable exactly
 * when the server says so — the same `availableActions` the rest of the card obeys — and
 * read-only otherwise, so a registered document still shows its text without offering a
 * toolbar that would only produce a 409.
 */
export function DocumentContentSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const update = useUpdateDocument();
  const canEdit = doc.availableActions.includes('edit');

  const save = async (content: DocumentContent): Promise<void> => {
    // The freshest version wins the optimistic check; autosave sends the one it holds and
    // lets the server arbitrate rather than guessing.
    await update.mutateAsync({ id: doc.id, input: { expectedVersion: doc.version, content } });
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <FileText className="size-4" aria-hidden /> {t('content.title')}
      </h2>
      {!canEdit && !doc.content ? (
        <EmptyState
          icon={FileText}
          title={t('content.empty.title')}
          description={t('content.empty.description')}
        />
      ) : (
        <DocumentContentEditor
          key={`${doc.id}-${canEdit ? 'edit' : 'read'}`}
          value={doc.content}
          readOnly={!canEdit}
          {...(canEdit ? { onSave: save } : {})}
        />
      )}
    </section>
  );
}
