import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { Button, Input, Label, Slider } from '@cuks/ui';
import {
  addCalendarDays,
  calendarDaysBetween,
  formatCalendarDateRu,
  type IncidentFilterState,
} from '../lib/incident-filters';

export interface IncidentTimelineProps {
  value: IncidentFilterState;
  onChange: (value: IncidentFilterState) => void;
}

const PLAY_INTERVAL_MS = 900;

export function IncidentTimeline({ value, onChange }: IncidentTimelineProps): React.JSX.Element {
  const { t } = useTranslation('map');
  const [playing, setPlaying] = useState(false);
  const span = Math.max(0, calendarDaysBetween(value.dateFrom, value.dateTo));
  const cursorOffset = Math.max(
    0,
    Math.min(span, calendarDaysBetween(value.dateFrom, value.cursorDate)),
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (value.cursorDate >= value.dateTo) {
        setPlaying(false);
        return;
      }
      onChange({ ...value, cursorDate: addCalendarDays(value.cursorDate, 1) });
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [onChange, playing, value]);

  const setDateFrom = (dateFrom: string): void => {
    if (!dateFrom) return;
    const dateTo = dateFrom > value.dateTo ? dateFrom : value.dateTo;
    onChange({ ...value, dateFrom, dateTo, cursorDate: dateTo });
    setPlaying(false);
  };

  const setDateTo = (dateTo: string): void => {
    if (!dateTo) return;
    const dateFrom = dateTo < value.dateFrom ? dateTo : value.dateFrom;
    onChange({ ...value, dateFrom, dateTo, cursorDate: dateTo });
    setPlaying(false);
  };

  const togglePlayback = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (value.cursorDate >= value.dateTo) {
      onChange({ ...value, cursorDate: value.dateFrom });
    }
    setPlaying(true);
  };

  return (
    <section
      className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-3xl rounded border border-border bg-surface p-3 shadow-[var(--shadow-2)]"
      aria-label={t('timeline.label')}
      data-testid="incident-timeline"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 md:flex md:gap-3">
        <div className="min-w-0 md:w-36 md:shrink-0">
          <Label htmlFor="incident-date-from" className="mb-1 block text-xs text-text-muted">
            {t('timeline.from')}
          </Label>
          <Input
            id="incident-date-from"
            type="date"
            lang="ru"
            value={value.dateFrom}
            max={value.dateTo}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </div>
        <div className="min-w-0 md:w-36 md:shrink-0">
          <Label htmlFor="incident-date-to" className="mb-1 block text-xs text-text-muted">
            {t('timeline.to')}
          </Label>
          <Input
            id="incident-date-to"
            type="date"
            lang="ru"
            value={value.dateTo}
            min={value.dateFrom}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={togglePlayback}
          aria-label={playing ? t('timeline.pause') : t('timeline.play')}
          title={playing ? t('timeline.pause') : t('timeline.play')}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <div className="col-span-3 min-w-0 pb-1 md:col-span-1 md:flex-1">
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
            <span>{t('timeline.progress')}</span>
            <output className="font-medium tabular-nums text-text" aria-live="polite">
              {formatCalendarDateRu(value.cursorDate)}
            </output>
          </div>
          <Slider
            value={[cursorOffset]}
            min={0}
            max={Math.max(span, 1)}
            step={1}
            disabled={span === 0}
            onValueChange={(next) => {
              setPlaying(false);
              const nextOffset = Math.max(0, Math.min(span, next[0] ?? 0));
              onChange({ ...value, cursorDate: addCalendarDays(value.dateFrom, nextOffset) });
            }}
            aria-label={t('timeline.slider')}
          />
        </div>
      </div>
    </section>
  );
}
