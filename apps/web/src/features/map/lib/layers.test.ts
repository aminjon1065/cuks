import type { LayerSpecification, Map as MlMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import type { GisLayerDto } from '@cuks/shared';
import {
  applyFilter,
  applyOpacity,
  applyVisibility,
  compileLayers,
  defaultLayerStates,
  drawnLayerDefs,
  layerFilter,
  opacityTargets,
  orderedLayers,
  incidentPulseFrame,
  sublayerIds,
  SYSTEM_LAYERS,
  type MapLayerDef,
} from './layers';

const token = (name: string): string => (name === '--primary' ? '#111111' : '#222222');

function def(id: string): MapLayerDef {
  const found = SYSTEM_LAYERS.find((d) => d.id === id);
  if (!found) throw new Error(`no such layer ${id}`);
  return found;
}

type Fill = Extract<LayerSpecification, { type: 'fill' }>;
type Line = Extract<LayerSpecification, { type: 'line' }>;
type Circle = Extract<LayerSpecification, { type: 'circle' }>;
type SymbolLayer = Extract<LayerSpecification, { type: 'symbol' }>;

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
  it('sorts by group z-order (boundaries first, operational markers last)', () => {
    const groups = orderedLayers().map((d) => d.group);
    expect(groups[0]).toBe('boundaries');
    expect(groups[groups.length - 1]).toBe('operational');
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
    const [drawn] = drawnLayerDefs([drawnLayer()]);
    const layers = compileLayers(drawn!, token, { visible: true, opacity: 1 });
    expect(layers.map((l) => l.id)).toEqual([
      'drawn:layer-1-fill',
      'drawn:layer-1-line',
      'drawn:layer-1-point',
    ]);
  });

  it('sets the source and source-layer on every compiled layer', () => {
    for (const layer of compileLayers(def('risk_zones'), token, { visible: true, opacity: 1 })) {
      expect(layer).toMatchObject({ source: 'risk_zones', 'source-layer': 'risk_zones' });
    }
  });

  it('compiles counted clusters and status-shaped severity markers', () => {
    const layers = compileLayers(def('incidents'), token, { visible: true, opacity: 1 });
    expect(layers.map((layer) => layer.id)).toEqual([
      'incidents-clusters',
      'incidents-cluster-count',
      'incidents-active-pulse',
      'incidents',
    ]);
    expect(layers.every((layer) => 'source' in layer && layer.source === 'incidents_mvt')).toBe(
      true,
    );
    const count = layers[1] as SymbolLayer;
    expect(count.filter).toEqual(['>', ['get', 'cluster_count'], 1]);
    expect(count.layout?.['icon-image']).toEqual([
      'concat',
      'incident-cluster-count-',
      ['to-string', ['get', 'cluster_count']],
    ]);
    const marker = layers[3] as SymbolLayer;
    expect(marker.layout?.['icon-image']).toEqual(
      expect.arrayContaining(['concat', 'incident-status-']),
    );
    expect(def('incidents').legend.map((item) => item.labelKey)).toEqual(
      expect.arrayContaining([
        'legend.statusReported',
        'legend.statusActive',
        'legend.statusLocalized',
        'legend.statusEliminated',
        'legend.statusClosed',
      ]),
    );
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
    const [drawn] = drawnLayerDefs([drawnLayer()]);
    expect(opacityTargets(drawn!).map((t) => t.prop)).toEqual([
      'fill-opacity',
      'line-opacity',
      'circle-opacity',
      'circle-stroke-opacity',
    ]);
  });

  it('targets cluster, pulse, marker, and strokes for the incident layer', () => {
    expect(opacityTargets(def('incidents')).map((target) => target.layerId)).toEqual([
      'incidents-clusters',
      'incidents-clusters',
      'incidents-cluster-count',
      'incidents-active-pulse',
      'incidents',
    ]);
  });
});

describe('incidentPulseFrame', () => {
  it('expands and fades the halo while clamping progress', () => {
    expect(incidentPulseFrame(0)).toEqual({ radius: 9, opacity: 0.28 });
    expect(incidentPulseFrame(1)).toEqual({ radius: 18, opacity: 0 });
    expect(incidentPulseFrame(2)).toEqual({ radius: 18, opacity: 0 });
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

function drawnLayer(overrides: Partial<GisLayerDto> = {}): GisLayerDto {
  return {
    id: 'layer-1',
    slug: 'cordon',
    title: 'Оцепление',
    kind: 'drawn',
    geometryType: 'Polygon',
    style: { color: '#b91c1c' },
    description: null,
    minZoom: null,
    maxZoom: null,
    createdBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    canEdit: true,
    canManage: true,
    ...overrides,
  };
}

describe('drawnLayerDefs', () => {
  it('scopes each drawn layer to its own features in the shared source', () => {
    const [def] = drawnLayerDefs([drawnLayer()]);
    expect(def).toMatchObject({
      id: 'drawn:layer-1',
      source: 'layer_features_mvt',
      sourceLayer: 'layer_features',
      group: 'mine',
      title: 'Оцепление',
      color: '#b91c1c',
    });
    expect(def!.filter).toEqual(['==', ['get', 'layer_id'], 'layer-1']);
  });

  it('falls back to the design token when the stored color is not a hex', () => {
    const [def] = drawnLayerDefs([drawnLayer({ style: { color: 'red; drop table' } })]);
    expect(def!.color).toBeUndefined();
    expect(def!.colorToken).toBe('--success');
  });

  it('renders drawn layers above the polygon layers but below the incidents', () => {
    const ordered = orderedLayers(drawnLayerDefs([drawnLayer()])).map((def) => def.id);
    expect(ordered.indexOf('drawn:layer-1')).toBeGreaterThan(ordered.indexOf('risk_zones'));
    expect(ordered.indexOf('drawn:layer-1')).toBeLessThan(ordered.indexOf('incidents'));
  });
});

describe('layerFilter', () => {
  it('keeps the layer scope and hides the feature open in the geometry editor', () => {
    const [def] = drawnLayerDefs([drawnLayer()]);
    expect(layerFilter(def!, 'f-1')).toEqual([
      'all',
      ['==', ['get', 'layer_id'], 'layer-1'],
      ['!=', ['get', 'id'], 'f-1'],
    ]);
  });

  it('leaves system layers alone (their filters are structural)', () => {
    expect(layerFilter(def('admin_units'), 'f-1')).toBeNull();
    const map = { getLayer: vi.fn(() => ({}) as unknown), setFilter: vi.fn() };
    applyFilter(map as unknown as MlMap, def('admin_units'), 'f-1');
    expect(map.setFilter).not.toHaveBeenCalled();
  });

  it('applies the edit filter to every sublayer of a drawn layer', () => {
    const [layer] = drawnLayerDefs([drawnLayer()]);
    const map = { getLayer: vi.fn(() => ({}) as unknown), setFilter: vi.fn() };
    applyFilter(map as unknown as MlMap, layer!, 'f-1');
    expect(map.setFilter).toHaveBeenCalledTimes(3);
    expect(map.setFilter).toHaveBeenCalledWith('drawn:layer-1-fill', [
      'all',
      ['==', ['get', 'layer_id'], 'layer-1'],
      ['!=', ['get', 'id'], 'f-1'],
    ]);
  });
});

describe('compileLayers (drawn)', () => {
  it('paints the layer in its own color and filters the shared source', () => {
    const [layer] = drawnLayerDefs([drawnLayer()]);
    const compiled = compileLayers(layer!, token, { visible: true, opacity: 1 });
    const fill = compiled[0] as Fill;
    expect(fill.id).toBe('drawn:layer-1-fill');
    expect(fill.paint?.['fill-color']).toBe('#b91c1c');
    expect(fill.filter).toEqual(['==', ['get', 'layer_id'], 'layer-1']);
  });
});
