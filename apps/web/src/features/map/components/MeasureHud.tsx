import { useTranslation } from 'react-i18next';
import { formatAreaSquareMeters, formatDistanceMeters, type MeasureReading } from '../lib/measure';

export interface MeasureHudProps {
  reading: MeasureReading | null;
  hint: 'distance' | 'area' | null;
}

/** Live distance/area readout while the measure tool is active. */
export function MeasureHud({ reading, hint }: MeasureHudProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation('map');
  if (!hint && !reading) return null;

  const locale = i18n.resolvedLanguage === 'tg' ? 'tg-TJ' : 'ru-RU';
  let primary: string | null = null;
  if (reading?.mode === 'distance' && reading.pointCount >= 2) {
    const formatted = formatDistanceMeters(reading.meters, locale);
    primary = t(`tools.units.${formatted.unit}`, { n: formatted.n });
  } else if (reading?.mode === 'area' && reading.squareMeters != null) {
    const formatted = formatAreaSquareMeters(reading.squareMeters, locale);
    primary = t(`tools.units.${formatted.unit}`, { n: formatted.n });
  }

  return (
    <div
      className="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded border border-border bg-surface px-3 py-1.5 text-center shadow-[var(--shadow-2)]"
      data-testid="measure-hud"
      role="status"
      aria-live="polite"
    >
      {primary ? <p className="text-sm font-medium tabular-nums text-text">{primary}</p> : null}
      {hint ? <p className="text-xs text-text-muted">{t(`tools.hint.${hint}`)}</p> : null}
    </div>
  );
}
