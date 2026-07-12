import { useTranslation } from 'react-i18next';
import { ShieldX } from 'lucide-react';
import { StatusPage } from './StatusPage';

export function ForbiddenPage(): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <StatusPage
      code="403"
      icon={ShieldX}
      title={t('forbidden.title')}
      description={t('forbidden.description')}
    />
  );
}
