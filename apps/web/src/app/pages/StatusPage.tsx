import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@cuks/ui';

/** Centered full-screen status page for 403 / 404. */
export function StatusPage({
  code,
  icon: Icon,
  title,
  description,
}: {
  code: string;
  icon: LucideIcon;
  title: string;
  description: string;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-text-muted">
        <Icon className="size-7" />
      </div>
      <div className="font-mono text-xs text-text-muted">{code}</div>
      <div>
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        <p className="mt-1 max-w-sm text-[13px] text-text-muted">{description}</p>
      </div>
      <Button variant="outline" onClick={() => navigate('/app')}>
        {t('actions.goHome')}
      </Button>
    </div>
  );
}
