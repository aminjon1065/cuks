import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as echarts from 'echarts';
import { cssToken } from '@/features/map/lib/map-config';

export interface EChartHandle {
  exportPng: (name: string) => void;
}

export interface EChartProps {
  option: echarts.EChartsOption;
  /** A GeoJSON map to register before the option is applied (for the choropleth). */
  map?: { name: string; geoJson: unknown } | undefined;
  height: number;
  className?: string;
}

/**
 * Imperative ECharts wrapper (the app's convention for library components — cf.
 * the MapLibre inset). Inits on mount, re-applies the option on change, resizes
 * with its container, disposes on unmount, and exposes a PNG export. This module
 * carries the echarts runtime, so it is only ever reached through a lazy import.
 */
export const EChart = forwardRef<EChartHandle, EChartProps>(function EChart(
  { option, map, height, className },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      exportPng: (name: string) => {
        const url = chartRef.current?.getDataURL({
          type: 'png',
          pixelRatio: 2,
          backgroundColor: cssToken('--surface', '#ffffff'),
        });
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}.png`;
        link.click();
      },
    }),
    [],
  );

  useEffect(() => {
    const element = elRef.current;
    if (!element) return;
    const chart = echarts.init(element);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (map) {
      echarts.registerMap(map.name, map.geoJson as Parameters<typeof echarts.registerMap>[1]);
    }
    chart.setOption(option, true);
  }, [option, map]);

  return <div ref={elRef} className={className} style={{ height, width: '100%' }} />;
});
