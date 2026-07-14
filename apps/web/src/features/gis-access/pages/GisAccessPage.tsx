import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Globe, Info } from 'lucide-react';
import { PageHeader, Skeleton } from '@cuks/ui';
import { useCan } from '@/lib/ability';
import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import { useGisAccessInfo } from '@/features/map/api/queries';
import { CopyField } from '../components/CopyField';

/**
 * «Для ГИС-специалистов» (docs/modules/10 §7, task 2.9). Ready-to-use connection
 * details for QGIS/ArcGIS — the direct PostGIS coordinates (the primary path) and
 * the OGC WMS/WFS endpoints when GeoServer is configured — plus step-by-step
 * connection instructions. The credentials themselves are issued separately (an
 * admin creates a scoped account under Admin → «Доступ ГИС»).
 */
export function GisAccessPage(): React.JSX.Element {
  const { t } = useTranslation('gisAccess');
  const canView = useCan('gis.view');
  const info = useGisAccessInfo();

  useEffect(() => {
    document.title = t('title');
  }, [t]);

  if (!canView) return <ForbiddenPage />;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-y-auto p-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {info.isPending ? (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : info.isError || !info.data ? (
        <p className="mt-6 text-sm text-danger">{t('loadFailed')}</p>
      ) : (
        <div className="mt-6 space-y-6">
          {/* --- Direct PostGIS (primary path) --- */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-text">
              <Database className="size-4 text-primary" />
              {t('postgis.title')}
            </div>
            <p className="mb-4 text-[13px] text-text-muted">{t('postgis.description')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyField
                label={t('postgis.host')}
                value={info.data.postgis.host}
                testId="pg-host"
              />
              <CopyField
                label={t('postgis.port')}
                value={String(info.data.postgis.port)}
                testId="pg-port"
              />
              <CopyField label={t('postgis.database')} value={info.data.postgis.database} />
              <CopyField label={t('postgis.schema')} value={info.data.postgis.schema} />
            </div>
            <ClientSteps section="postgis" />
          </section>

          {/* --- OGC WMS/WFS (secondary path) --- */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-text">
              <Globe className="size-4 text-primary" />
              {t('ogc.title')}
            </div>
            {info.data.ogc ? (
              <>
                <p className="mb-4 text-[13px] text-text-muted">{t('ogc.description')}</p>
                <div className="grid gap-3">
                  <CopyField
                    label={t('ogc.wms')}
                    value={info.data.ogc.wms}
                    testId="ogc-wms"
                    mono={false}
                  />
                  <CopyField
                    label={t('ogc.wfs')}
                    value={info.data.ogc.wfs}
                    testId="ogc-wfs"
                    mono={false}
                  />
                </div>
                <ClientSteps section="ogc" />
              </>
            ) : (
              <div className="flex items-start gap-2 text-[13px] text-text-muted">
                <Info className="mt-0.5 size-4 shrink-0" />
                {t('ogc.unavailable')}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** QGIS and ArcGIS Pro connection steps side by side (docs/modules/10 §7 requires
 *  instructions for both clients). */
function ClientSteps({ section }: { section: 'postgis' | 'ogc' }): React.JSX.Element {
  const { t } = useTranslation('gisAccess');
  return (
    <div className="mt-4 grid gap-5 sm:grid-cols-2">
      <StepGroup
        title={t(`${section}.qgisTitle`)}
        items={t(`${section}.qgisSteps`, { returnObjects: true }) as string[]}
      />
      <StepGroup
        title={t(`${section}.arcgisTitle`)}
        items={t(`${section}.arcgisSteps`, { returnObjects: true }) as string[]}
      />
    </div>
  );
}

/** One client's numbered instruction list under a small heading. */
function StepGroup({ title, items }: { title: string; items: string[] }): React.JSX.Element | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </div>
      <ol className="list-inside list-decimal space-y-1 text-[13px] text-text-muted">
        {items.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
