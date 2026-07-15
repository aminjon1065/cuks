import { useTranslation } from 'react-i18next';
import { ClipboardList, FileText, type LucideIcon } from 'lucide-react';

/**
 * «Требует внимания» — an aggregator of the current user's items from other
 * modules (docs/modules/10 §8). The task and document sources land in Phases 3–4;
 * until then each renders its own empty state, and the widget lights up per source
 * as its module arrives (no backend dependency yet).
 */
interface AttentionSource {
  key: 'tasks' | 'documents';
  icon: LucideIcon;
}

const SOURCES: readonly AttentionSource[] = [
  { key: 'tasks', icon: ClipboardList },
  { key: 'documents', icon: FileText },
];

export function AttentionWidget(): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <div className="space-y-4">
      {SOURCES.map(({ key, icon: Icon }) => (
        <div key={key}>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
            <Icon className="size-3.5" aria-hidden />
            {t(`attention.${key}.title`)}
          </div>
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-text-muted">
            {t(`attention.${key}.pending`)}
          </div>
        </div>
      ))}
    </div>
  );
}
