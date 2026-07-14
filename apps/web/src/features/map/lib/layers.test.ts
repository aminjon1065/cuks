import type { LayerSpecification, Map as MlMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import {
  applyOpacity,
  applyVisibility,
  compileLayers,
  defaultLayerStates,
  opacityTargets,
  orderedLayers,
  sublayerIds,
  SYSTEM_LAYERS,
  type SystemLayerDef,
} from './layers';

const token = (name: string): string => (name === '--primary' ? '#111111' : '#222222');

function def(id: string): SystemLayerDef {
  const found = SYSTEM_LAYERS.find((d) => d.id === id);
  if (!found) throw new Error(`no such layer ${id}`);
  return found;
}

type Fill = Extract<LayerSpecification, { type: 'fill' }>;
type Line = Extract<LayerSpecification, { type: 'line' }>;
type Circle = Extract<LayerSpecification, { type: 'circle' }>;

describe('defaultLayerStates', () => {
  it('seeds one state per system layer using its default visibility', () => {
    const states = defaultLayerStates();
    expect(Object.keys(states).sort()).toEqual(SYSTEM_LAYERS.map((d) => d.id).sort());
    for (const layer of SYSTEM_LAYERS) {
      expect(states[layer.id]).toEqual({ visible: layer.defaultVisible, opacity: 1 });
    }
  });
});

describe('orderedLayers', () => {
  it('sorts by group z-order (boundaries first, mine last)', () => {
    const groups = orderedLayers().map((d) => d.group);
    expect(groups[0]).toBe('boundaries');
    expect(groups[groups.length - 1]).toBe('mine');
  });
});

describe('compileLayers', () => {
  it('compiles a fill layer into fill + outline with token colors and scaled opacity', () => {
    const layers = compileLayers(def('admin_units'), token, { visible: true, opacity: 0.5 });
    expect(layers.map((l) => l.id)).toEqual(['admin_units', 'admin_units-outline']);

    const fill = layers[0] as Fill;
    expect(fill.type).toBe('fill');
    expect(fill.paint?.['fill-color']).toBe('#111111');
    // base fillOpacity 0.04 * user opacity 0.5
    expect(fill.paint?.['fill-opacity']).toBeCloseTo(0.02);
    expect(fill.layout?.visibility).toBe('visible');

    const outline = layers[1] as Line;
    expect(outline.type).toBe('line');
    expect(outline.paint?.['line-color']).toBe('#111111');
  });

  it('hides layers via layout visibility when not visible', () => {
    const layers = compileLayers(def('facilities'), token, { visible: false, opacity: 1 });
    const circle = layers[0] as Circle;
    expect(circle.type).toBe('circle');
    expect(circle.layout?.visibility).toBe('none');
    expect(circle.paint?.['circle-color']).toBe('#222222');
  });

  it('compiles a mixed (drawn) layer into fill + line + point sublayers', () => {
    const layers = compileLayers(def('layer_features'), token, { visible: true, opacity: 1 });
    expect(layers.map((l) => l.id)).toEqual([
      'layer_features-fill',
      'layer_features-line',
      'layer_features-point',
    ]);
  });

  it('sets the source and source-layer on every compiled layer', () => {
    for (const layer of compileLayers(def('risk_zones'), token, { visible: true, opacity: 1 })) {
      expect(layer).toMatchObject({ source: 'risk_zones', 'source-layer': 'risk_zones' });
    }
  });
});

describe('sublayerIds / opacityTargets', () => {
  it('lists fill sublayers and their opacity props', () => {
    expect(sublayerIds(def('admin_units'))).toEqual(['admin_units', 'admin_units-outline']);
    expect(opacityTargets(def('admin_units')).map((t) => t.prop)).toEqual([
      'fill-opacity',
      'line-opacity',
    ]);
  });

  it('targets both circle opacity props for a circle layer', () => {
    expect(opacityTargets(def('facilities')).map((t) => t.prop)).toEqual([
      'circle-opacity',
      'circle-stroke-opacity',
    ]);
  });

  it('dims the point stroke of a mixed layer (fill/line/circle + stroke)', () => {
    expect(opacityTargets(def('layer_features')).map((t) => t.prop)).toEqual([
      'fill-opacity',
      'line-opacity',
      'circle-opacity',
      'circle-stroke-opacity',
    ]);
  });
});

describe('applyVisibility / applyOpacity', () => {
  function fakeMap() {
    return {
      getLayer: vi.fn(() => ({}) as unknown),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
    };
  }

  it('applies visibility to every sublayer that exists', () => {
    const map = fakeMap();
    applyVisibility(map as unknown as MlMap, def('admin_units'), false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('admin_units', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('admin_units-outline', 'visibility', 'none');
  });

  it('scales base opacity by the user opacity', () => {
    const map = fakeMap();
    applyOpacity(map as unknown as MlMap, def('risk_zones'), 0.5);
    // risk_zones fill base 0.3 * 0.5 = 0.15
    expect(map.setPaintProperty).toHaveBeenCalledWith('risk_zones', 'fill-opacity', 0.15);
  });

  it('skips sublayers absent from the map', () => {
    const map = fakeMap();
    map.getLayer.mockReturnValue(undefined as unknown);
    applyVisibility(map as unknown as MlMap, def('facilities'), true);
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
  });
});
