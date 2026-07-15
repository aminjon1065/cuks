import { useTranslation } from 'react-i18next';
import type { ReportMetric, ReportResultDto } from '@cuks/shared';
import { formatDamage, formatNumber } from '@/features/incidents/lib';

function formatMetric(metric: ReportMetric, value: number | string | undefined): string {
  if (metric === 'damage') return formatDamage(String(value ?? '0')) ?? '0';
  return formatNumber(Number(value ?? 0));
}

/** The aggregated report table: dimension columns + metric columns (+ АППГ columns
 *  when comparing), with a totals row when the report is grouped. */
export function ReportTable({ result }: { result: ReportResultDto }): React.JSX.Element {
  const { t } = useTranslation('reports');
  const { dimensions, metrics, compareYoY, rows, totals } = result;
  const th = 'px-3 py-2 font-medium';
  const td = 'px-3 py-2 text-text';
  const num = 'px-3 py-2 text-right tabular-nums';

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-left text-text-muted">
            {dimensions.map((dim) => (
              <th key={dim} className={th}>
                {t(`dimension.${dim}`)}
              </th>
            ))}
            {metrics.map((metric) => (
              <th key={metric} className={`${th} text-right`}>
                {t(`metric.${metric}`)}
              </th>
            ))}
            {compareYoY &&
              metrics.map((metric) => (
                <th key={`prev-${metric}`} className={`${th} text-right text-text-muted`}>
                  {t('yoyColumn', { metric: t(`metric.${metric}`) })}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border last:border-0">
              {row.keys.map((key, keyIndex) => (
                <td key={keyIndex} className={td}>
                  {key}
                </td>
              ))}
              {metrics.map((metric, metricIndex) => (
                <td key={metric} className={`${num} text-text`}>
                  {formatMetric(metric, row.values[metricIndex])}
                </td>
              ))}
              {compareYoY &&
                metrics.map((metric, metricIndex) => (
                  <td key={`prev-${metric}`} className={`${num} text-text-muted`}>
                    {formatMetric(metric, row.valuesPrev?.[metricIndex])}
                  </td>
                ))}
            </tr>
          ))}
          {dimensions.length > 0 && (
            <tr className="border-t-2 border-border bg-surface-2/40 font-medium">
              <td className={td} colSpan={dimensions.length}>
                {t('total')}
              </td>
              {metrics.map((metric, metricIndex) => (
                <td key={metric} className={num}>
                  {formatMetric(metric, totals.values[metricIndex])}
                </td>
              ))}
              {compareYoY &&
                metrics.map((metric, metricIndex) => (
                  <td key={`prev-${metric}`} className={`${num} text-text-muted`}>
                    {formatMetric(metric, totals.valuesPrev?.[metricIndex])}
                  </td>
                ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
