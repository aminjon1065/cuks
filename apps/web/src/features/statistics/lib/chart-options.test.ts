import { describe, expect, it } from 'vitest';
import type { EChartsOption } from 'echarts';
import {
  byTypeOption,
  casualtiesOption,
  choroplethOption,
  heatmapOption,
  isEmptyStats,
  monthlyOption,
  topRegionsOption,
  type ChartLabels,
} from './chart-options';
import type { ChartTheme } from './echarts-theme';

const theme: ChartTheme = {
  text: '#000',
  textMuted: '#666',
  border: '#ccc',
  surface: '#fff',
  primary: '#00f',
  success: '#0f0',
  warning: '#fa0',
  danger: '#f00',
  info: '#0af',
  sev: ['#1', '#2', '#3', '#4', '#5'],
  palette: ['#a'],
};
const labels: ChartLabels = {
  incidents: 'ЧС',
  dead: 'Погибшие',
  injured: 'Пострадавшие',
  evacuated: 'Эвакуированные',
  damage: 'Ущерб',
  dowNames: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
};

// Narrow the loose ECharts option types for assertions.
const series = (o: EChartsOption) => o.series as Record<string, unknown>[];
const axis = (a: unknown) => a as { data: unknown[] };

describe('chart-options', () => {
  it('monthlyOption puts months on the x-axis and pairs a bar with a line', () => {
    const opt = monthlyOption(
      [{ month: '2026-06', count: 5, dead: 1, injured: 2, damage: '0' }],
      theme,
      labels,
    );
    expect(axis(opt.xAxis).data).toEqual(['2026-06']);
    expect(series(opt).map((s) => s['type'])).toEqual(['bar', 'line']);
  });

  it('byTypeOption sorts ascending so the largest bar is on top', () => {
    const opt = byTypeOption(
      [
        { typeCode: 'a', typeName: 'A', count: 3 },
        { typeCode: 'b', typeName: 'B', count: 9 },
      ],
      theme,
    );
    expect(axis(opt.yAxis).data).toEqual(['A', 'B']);
  });

  it('heatmapOption maps ISO dow (1=Mon) to a 0-based y index', () => {
    const opt = heatmapOption([{ dow: 1, hour: 9, count: 3 }], theme, labels);
    expect(series(opt)[0]!['data']).toEqual([[9, 0, 3]]);
    expect(axis(opt.yAxis).data).toEqual(labels.dowNames);
  });

  it('choroplethOption keys map data by region name', () => {
    const opt = choroplethOption(
      [{ regionId: 'r1', regionName: 'Душанбе', count: 7 }],
      'cuks-regions',
      theme,
    );
    expect(series(opt)[0]!['map']).toBe('cuks-regions');
    expect(series(opt)[0]!['data']).toEqual([{ name: 'Душанбе', value: 7 }]);
  });

  it('topRegionsOption keeps at most ten units', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({
      regionId: `r${i}`,
      regionName: `R${i}`,
      count: i,
    }));
    const opt = topRegionsOption(data, theme);
    expect(axis(opt.yAxis).data).toHaveLength(10);
  });

  it('casualtiesOption stacks dead/injured/evacuated', () => {
    const opt = casualtiesOption(
      [{ typeCode: 'a', typeName: 'A', dead: 1, injured: 2, evacuated: 3, damage: '100' }],
      theme,
      labels,
      (v) => v,
    );
    const s = series(opt);
    expect(s).toHaveLength(3);
    expect(s.every((item) => item['stack'] === 'c')).toBe(true);
  });

  it('isEmptyStats is true only when there are no type rows', () => {
    expect(isEmptyStats([])).toBe(true);
    expect(isEmptyStats([{ typeCode: 'x', typeName: 'X', count: 1 }])).toBe(false);
  });
});
