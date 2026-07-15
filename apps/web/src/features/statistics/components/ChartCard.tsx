import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@cuks/ui';
import type { EChartsOption } from 'echarts';
import { EChart, type EChartHandle } from './EChart';

/** A titled chart card with a PNG-export button (docs/modules/10 §8: each chart
 *  exports PNG). The export control is hidden when printing. */
export function ChartCard({
  title,
  option,
  map,
  exportName,
  height = 280,
  className,
}: {
  title: string;
  option: EChartsOption;
  map?: { name: string; geoJson: unknown } | undefined;
  exportName: string;
  height?: number;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation('statistics');
  const chartRef = useRef<EChartHandle>(null);
  return (
    <section className={`rounded-lg border border-border bg-surface p-4 ${className ?? ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-text-muted print:hidden"
          onClick={() => chartRef.current?.exportPng(exportName)}
          aria-label={t('exportPng')}
          title={t('exportPng')}
        >
          <Download className="size-4" />
        </Button>
      </div>
      <EChart ref={chartRef} option={option} map={map} height={height} />
    </section>
  );
}
