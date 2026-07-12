import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { EmptyState, PageHeader } from '@cuks/ui';
import { ADMIN_NAV, MAIN_NAV } from '../shell/nav-items';

/** Placeholder for module routes not yet built (docs/06 states pattern). */
export function ComingSoonPage(): React.JSX.Element {
  const { t } = useTranslation('common');
  const { t: tn } = useTranslation('nav');
  const { pathname } = useLocation();
  const item = [...MAIN_NAV, ...ADMIN_NAV]
    .filter((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const title = item ? tn(`items.${item.key}`) : t('comingSoon.title');

  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <EmptyState
        icon={Construction}
        title={t('comingSoon.title')}
        description={t('comingSoon.description')}
      />
    </div>
  );
}
