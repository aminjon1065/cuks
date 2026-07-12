import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { EmptyState, PageHeader } from '@cuks/ui';

export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <EmptyState
        icon={LayoutDashboard}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    </div>
  );
}
