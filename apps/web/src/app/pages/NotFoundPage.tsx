import { useTranslation } from 'react-i18next';
import { FileQuestion } from 'lucide-react';
import { StatusPage } from './StatusPage';

export function NotFoundPage(): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <StatusPage
      code="404"
      icon={FileQuestion}
      title={t('notFound.title')}
      description={t('notFound.description')}
    />
  );
}
