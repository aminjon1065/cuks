import type { MapGeoJSONFeature } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { GisLayerDto } from '@cuks/shared';
import { inspectableLayerIds, inspectFeatures, toInspected } from './inspect';
import { drawnLayerDefs, SYSTEM_LAYERS } from './layers';

/** A vector-tile hit as MapLibre hands it to `queryRenderedFeatures`. */
function hit(sourceLayer: string, properties: Record<string, unknown>): MapGeoJSONFeature {
  return { sourceLayer, properties } as unknown as MapGeoJSONFeature;
}

function layer(overrides: Partial<GisLayerDto> = {}): GisLayerDto {
  return {
    id: 'layer-1',
    slug: 'cordon',
    title: 'Оцепление',
    kind: 'drawn',
    geometryType: 'Polygon',
    style: {},
    description: null,
    minZoom: null,
    maxZoom: null,
    createdBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    canEdit: true,
    canManage: true,
    isPublishedWms: false,
    geoserverLayer: null,
    ...overrides,
  };
}

const titles = new Map([['layer-1', 'Оцепление']]);

describe('toInspected', () => {
  it('maps an incident marker, keeping the id the incident card is opened by', () => {
    const feature = toInspected(
      hit('incidents', { feature_id: 'inc-1', number: 'ЧС-2026-7', severity: 3, cluster_count: 1 }),
      titles,
    );
    expect(feature).toMatchObject({ kind: 'incident', id: 'inc-1', title: 'ЧС-2026-7' });
  });

  it('drops incident clusters — clicking one zooms in, it is not an object', () => {
    expect(
      toInspected(hit('incidents', { is_cluster: true, cluster_count: 4 }), titles),
    ).toBeNull();
    expect(toInspected(hit('incidents', { feature_id: 'x', cluster_count: 9 }), titles)).toBeNull();
  });

  it('parses a drawn feature: layer title from the registry, props from the jsonb text', () => {
    const feature = toInspected(
      hit('layer_features', {
        id: 'f-1',
        layer_id: 'layer-1',
        props: '{"note":"зона"}',
      }),
      titles,
    );
    expect(feature).toEqual({
      kind: 'drawn',
      id: 'f-1',
      layerId: 'layer-1',
      title: 'Оцепление',
      props: { note: 'зона' },
    });
  });

  it('survives a drawn feature with malformed or empty props', () => {
    const feature = toInspected(hit('layer_features', { id: 'f-2', layer_id: 'layer-1' }), titles);
    expect(feature?.props).toEqual({});
    const broken = toInspected(
      hit('layer_features', { id: 'f-3', layer_id: 'layer-1', props: '{oops' }),
      titles,
    );
    expect(broken?.props).toEqual({});
  });

  it('flattens the jsonb attributes of infrastructure objects into the card', () => {
    const feature = toInspected(
      hit('facilities', { id: 'fac-1', name: 'Школа №1', attrs: '{"capacity":120}' }),
      titles,
    );
    expect(feature).toMatchObject({ kind: 'facility', title: 'Школа №1' });
    expect(feature?.props['capacity']).toBe(120);
  });

  it('ignores hits from layers that are not inspectable objects', () => {
    expect(toInspected(hit('roads', { id: 'r-1' }), titles)).toBeNull();
    expect(toInspected(hit('admin_units', {}), titles)).toBeNull();
  });
});

describe('inspectFeatures', () => {
  it('deduplicates a feature hit through several sublayers (fill + outline)', () => {
    const features = inspectFeatures(
      [
        hit('layer_features', { id: 'f-1', layer_id: 'layer-1', props: '{}' }),
        hit('layer_features', { id: 'f-1', layer_id: 'layer-1', props: '{}' }),
        hit('incidents', { feature_id: 'inc-1', number: 'ЧС-1', cluster_count: 1 }),
      ],
      titles,
    );
    expect(features).toHaveLength(2);
    expect(features.map((feature) => feature.id)).toEqual(['inc-1', 'f-1']);
  });

  it('puts the object the user aimed at first — the admin unit under it is always a hit', () => {
    const features = inspectFeatures(
      [
        hit('admin_units', { id: 'region-1', name_ru: 'ГБАО' }),
        hit('layer_features', { id: 'f-1', layer_id: 'layer-1', props: '{}' }),
        hit('incidents', { feature_id: 'inc-1', number: 'ЧС-1', cluster_count: 1 }),
      ],
      titles,
    );
    expect(features.map((feature) => feature.kind)).toEqual(['incident', 'drawn', 'admin_unit']);
  });

  it('caps a rubber-band selection', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      hit('incidents', { feature_id: `inc-${index}`, number: `ЧС-${index}`, cluster_count: 1 }),
    );
    expect(inspectFeatures(many, titles, 5)).toHaveLength(5);
  });
});

describe('inspectableLayerIds', () => {
  it('queries object layers but never the cluster bubbles', () => {
    const ids = inspectableLayerIds(SYSTEM_LAYERS, drawnLayerDefs([layer()]));
    expect(ids).toContain('incidents');
    expect(ids).toContain('facilities');
    expect(ids).toContain('drawn:layer-1-fill');
    expect(ids).not.toContain('incidents-clusters');
    expect(ids).not.toContain('incidents-cluster-count');
    expect(ids).not.toContain('incidents-active-pulse');
  });
});
