import type { EChartsOption } from 'echarts';
import type {
  RegionFeatureCollection,
  StatsByMonth,
  StatsByRegion,
  StatsByType,
  StatsCasualtiesByType,
  StatsHeatCell,
} from '@cuks/shared';
import type { ChartTheme } from './echarts-theme';

/** Translated labels the charts need (titles live on the card, not in ECharts). */
export interface ChartLabels {
  incidents: string;
  dead: string;
  injured: string;
  evacuated: string;
  damage: string;
  /** Monday-first weekday names, length 7. */
  dowNames: string[];
}

const grid = { left: 8, right: 16, top: 28, bottom: 8, containLabel: true };

function axis(theme: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { show: false },
    axisLabel: { color: theme.textMuted },
    splitLine: { lineStyle: { color: theme.border, opacity: 0.5 } },
  };
}

function tooltip(theme: ChartTheme) {
  return {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    textStyle: { color: theme.text, fontSize: 12 },
  };
}

function legend(theme: ChartTheme, data: string[]) {
  return { data, top: 0, textStyle: { color: theme.textMuted }, icon: 'roundRect' as const };
}

/** 1. Monthly dynamics: incident count (bar) + injured (line, right axis). */
export function monthlyOption(
  data: StatsByMonth[],
  theme: ChartTheme,
  labels: ChartLabels,
): EChartsOption {
  return {
    color: [theme.primary, theme.danger],
    grid,
    tooltip: { trigger: 'axis', ...tooltip(theme) },
    legend: legend(theme, [labels.incidents, labels.injured]),
    xAxis: { type: 'category', data: data.map((d) => d.month), ...axis(theme) },
    yAxis: [
      { type: 'value', ...axis(theme) },
      { type: 'value', ...axis(theme), splitLine: { show: false } },
    ],
    series: [
      {
        name: labels.incidents,
        type: 'bar',
        data: data.map((d) => d.count),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 32,
      },
      {
        name: labels.injured,
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: data.map((d) => d.injured),
      },
    ],
  };
}

/** 2. Distribution by incident type (horizontal bar). */
export function byTypeOption(data: StatsByType[], theme: ChartTheme): EChartsOption {
  const sorted = [...data].sort((a, b) => a.count - b.count);
  return {
    grid: { ...grid, top: 8 },
    tooltip: { trigger: 'item', ...tooltip(theme) },
    xAxis: { type: 'value', ...axis(theme) },
    yAxis: { type: 'category', data: sorted.map((d) => d.typeName), ...axis(theme) },
    series: [
      {
        type: 'bar',
        data: sorted.map((d) => d.count),
        itemStyle: { color: theme.info, borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 20,
      },
    ],
  };
}

/** 3. Choropleth by administrative unit (region today). */
export function choroplethOption(
  data: StatsByRegion[],
  mapName: string,
  theme: ChartTheme,
): EChartsOption {
  const max = Math.max(1, ...data.map((d) => d.count));
  return {
    tooltip: {
      trigger: 'item',
      ...tooltip(theme),
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number | undefined };
        return `${p.name}: ${p.value ?? 0}`;
      },
    },
    visualMap: {
      min: 0,
      max,
      left: 8,
      bottom: 8,
      calculable: true,
      inRange: { color: [theme.surface, theme.primary] },
      textStyle: { color: theme.textMuted },
    },
    series: [
      {
        type: 'map',
        map: mapName,
        roam: false,
        data: data.map((d) => ({ name: d.regionName, value: d.count })),
        // Base fill for regions absent from the data (e.g. filtered out) — the
        // visualMap tints only regions that have a value, so without this the
        // rest would fall back to ECharts' light default and break the dark theme.
        itemStyle: { areaColor: theme.surface, borderColor: theme.border },
        label: { show: false },
        emphasis: {
          label: { show: true, color: theme.text },
          itemStyle: { areaColor: theme.warning },
        },
      },
    ],
  };
}

/** 4. Day×hour heatmap (Asia/Dushanbe). */
export function heatmapOption(
  data: StatsHeatCell[],
  theme: ChartTheme,
  labels: ChartLabels,
): EChartsOption {
  const hours = Array.from({ length: 24 }, (_, hour) => String(hour));
  const max = Math.max(1, ...data.map((cell) => cell.count));
  return {
    tooltip: { position: 'top', ...tooltip(theme) },
    grid: { ...grid, top: 8, bottom: 48 },
    xAxis: { type: 'category', data: hours, ...axis(theme), splitArea: { show: true } },
    yAxis: { type: 'category', data: labels.dowNames, ...axis(theme), splitArea: { show: true } },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: [theme.surface, theme.warning, theme.danger] },
      textStyle: { color: theme.textMuted },
    },
    // `dow` is ISO (1=Mon…7=Sun) → y index 0…6 aligned with `dowNames`.
    series: [{ type: 'heatmap', data: data.map((c) => [c.hour, c.dow - 1, c.count]) }],
  };
}

/** 5. Top administrative units by incident count (horizontal bar). */
export function topRegionsOption(data: StatsByRegion[], theme: ChartTheme): EChartsOption {
  const top = [...data].slice(0, 10).sort((a, b) => a.count - b.count);
  return {
    grid: { ...grid, top: 8 },
    tooltip: { trigger: 'item', ...tooltip(theme) },
    xAxis: { type: 'value', ...axis(theme) },
    yAxis: { type: 'category', data: top.map((d) => d.regionName), ...axis(theme) },
    series: [
      {
        type: 'bar',
        data: top.map((d) => d.count),
        itemStyle: { color: theme.primary, borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 20,
      },
    ],
  };
}

/** 6. Casualties by type (stacked bar); damage shown in the tooltip. */
export function casualtiesOption(
  data: StatsCasualtiesByType[],
  theme: ChartTheme,
  labels: ChartLabels,
  formatDamage: (value: string) => string,
): EChartsOption {
  const damageByType = new Map(data.map((d) => [d.typeName, d.damage]));
  return {
    color: [theme.sev[3]!, theme.warning, theme.info],
    grid: { ...grid, bottom: 8 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltip(theme),
      formatter: (params: unknown) => {
        const rows = params as {
          name: string;
          seriesName: string;
          value: number;
          marker: string;
        }[];
        if (rows.length === 0) return '';
        const head = `<strong>${rows[0]!.name}</strong>`;
        const lines = rows.map((r) => `${r.marker}${r.seriesName}: ${r.value}`);
        const damage = damageByType.get(rows[0]!.name);
        if (damage) lines.push(`${labels.damage}: ${formatDamage(damage)}`);
        return [head, ...lines].join('<br/>');
      },
    },
    legend: legend(theme, [labels.dead, labels.injured, labels.evacuated]),
    xAxis: {
      type: 'category',
      data: data.map((d) => d.typeName),
      ...axis(theme),
      axisLabel: { color: theme.textMuted, interval: 0, rotate: data.length > 4 ? 30 : 0 },
    },
    yAxis: { type: 'value', ...axis(theme) },
    series: [
      { name: labels.dead, type: 'bar', stack: 'c', data: data.map((d) => d.dead) },
      { name: labels.injured, type: 'bar', stack: 'c', data: data.map((d) => d.injured) },
      { name: labels.evacuated, type: 'bar', stack: 'c', data: data.map((d) => d.evacuated) },
    ],
  };
}

/** Whether the stats payload has any incidents (for the empty state). */
export function isEmptyStats(byType: StatsByType[]): boolean {
  return byType.length === 0;
}

export type { RegionFeatureCollection };
