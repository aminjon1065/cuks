import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisLayerDto } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { defaultLayerStates, drawnLayerDefs, importedLayerDefs } from '../lib/layers';
import { LayersPanel, type LayersPanelProps } from './LayersPanel';

const ALL_SOURCES = new Set([
  'admin_units',
  'facilities',
  'risk_zones',
  'layer_features_mvt',
  'imported_mvt',
  'incidents_mvt',
]);

function layer(overrides: Partial<GisLayerDto> = {}): GisLayerDto {
  return {
    id: 'l1',
    slug: 'oceplenie',
    title: 'Оцепление',
    kind: 'drawn',
    geometryType: 'Polygon',
    style: { color: '#b91c1c' },
    description: null,
    minZoom: null,
    maxZoom: null,
    createdBy: 'u1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    canEdit: true,
    canManage: true,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<LayersPanelProps> = {}) {
  const props: LayersPanelProps = {
    states: defaultLayerStates(),
    availableSources: ALL_SOURCES,
    drawnDefs: [],
    activeLayerId: null,
    canCreateLayer: false,
    canImport: false,
    canExport: false,
    editLocked: false,
    layersLoading: false,
    layersError: false,
    onRetryLayers: vi.fn(),
    collapsed: false,
    onCollapsedChange: vi.fn(),
    onToggle: vi.fn(),
    onOpacity: vi.fn(),
    onZoom: vi.fn(),
    onActiveLayerChange: vi.fn(),
    onCreateLayer: vi.fn(),
    onImportLayer: vi.fn(),
    onExportLayer: vi.fn(),
    onDeleteLayer: vi.fn(),
    ...overrides,
  };
  render(
    <I18nextProvider i18n={i18n}>
      <LayersPanel {...props} />
    </I18nextProvider>,
  );
  return props;
}

describe('LayersPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders each group with its layers', () => {
    renderPanel({ canCreateLayer: true });
    expect(screen.getByText('Оперативная обстановка')).toBeInTheDocument();
    expect(screen.getByText('Границы')).toBeInTheDocument();
    expect(screen.getByText('Инфраструктура')).toBeInTheDocument();
    expect(screen.getByText('Риски')).toBeInTheDocument();
    expect(screen.getByText('Мои слои')).toBeInTheDocument();
    expect(screen.getByText('Административные границы')).toBeInTheDocument();
    expect(screen.getByText('Чрезвычайные ситуации')).toBeInTheDocument();
  });

  it('reflects default visibility on the checkboxes', () => {
    renderPanel();
    expect(screen.getByRole('checkbox', { name: 'Административные границы' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Чрезвычайные ситуации' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Зоны риска' })).not.toBeChecked();
  });

  it('toggles a layer through the checkbox', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Административные границы' }));
    expect(props.onToggle).toHaveBeenCalledWith('admin_units', false);
  });

  it('requests zoom-to-layer with the layer definition', () => {
    const props = renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: /Приблизить к слою «Объекты инфраструктуры»/ }),
    );
    expect(props.onZoom).toHaveBeenCalledWith(expect.objectContaining({ source: 'facilities' }));
  });

  it('shows opacity + legend only for visible layers', () => {
    renderPanel();
    // admin_units is visible by default → its legend label renders.
    expect(screen.getByText('Границы регионов')).toBeInTheDocument();
    // risk_zones is hidden by default → its legend label does not.
    expect(screen.queryByText('Зона риска')).not.toBeInTheDocument();
    expect(screen.getByText('Донесение')).toBeInTheDocument();
    expect(screen.getByText('В работе')).toBeInTheDocument();
    expect(screen.getByText('Локализована')).toBeInTheDocument();
    expect(screen.getByText('Ликвидирована')).toBeInTheDocument();
    expect(screen.getByText('Закрыта')).toBeInTheDocument();
    expect(screen.getAllByRole('slider').length).toBeGreaterThan(0);
  });

  it('gives each opacity slider an accessible name (on the role=slider thumb)', () => {
    renderPanel();
    expect(
      screen.getByRole('slider', { name: /Прозрачность слоя «Административные границы»/ }),
    ).toBeInTheDocument();
  });

  it('hides sources absent from the catalog', () => {
    renderPanel({ availableSources: new Set(['admin_units']) });
    expect(screen.getByText('Административные границы')).toBeInTheDocument();
    expect(screen.queryByText('Объекты инфраструктуры')).not.toBeInTheDocument();
    expect(screen.queryByText('Инфраструктура')).not.toBeInTheDocument();
  });

  it('collapses to a single expand button', () => {
    const props = renderPanel({ collapsed: true });
    const expand = screen.getByRole('button', { name: 'Показать слои' });
    fireEvent.click(expand);
    expect(props.onCollapsedChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Границы')).not.toBeInTheDocument();
  });

  describe('drawn layers', () => {
    it('lists a drawn layer and makes it the drawing target', () => {
      const props = renderPanel({ drawnDefs: drawnLayerDefs([layer()]) });
      expect(screen.getByText('Оцепление')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Рисовать в слое «Оцепление»' }));
      expect(props.onActiveLayerChange).toHaveBeenCalledWith('l1');
    });

    it('clears the drawing target when the active layer is toggled off', () => {
      const props = renderPanel({ drawnDefs: drawnLayerDefs([layer()]), activeLayerId: 'l1' });
      fireEvent.click(screen.getByRole('button', { name: 'Рисовать в слое «Оцепление»' }));
      expect(props.onActiveLayerChange).toHaveBeenCalledWith(null);
    });

    it('offers editing and deletion only where the ACL allows it', () => {
      renderPanel({
        drawnDefs: drawnLayerDefs([layer({ canEdit: false, canManage: false })]),
      });
      expect(
        screen.queryByRole('button', { name: 'Рисовать в слое «Оцепление»' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Удалить слой «Оцепление»' }),
      ).not.toBeInTheDocument();
    });

    it('locks target-switching and deletion while a geometry edit is unsaved', () => {
      renderPanel({ drawnDefs: drawnLayerDefs([layer()]), activeLayerId: 'l1', editLocked: true });
      expect(screen.getByRole('button', { name: 'Рисовать в слое «Оцепление»' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Удалить слой «Оцепление»' })).toBeDisabled();
    });

    it('shows the registry error with a retry instead of an empty «Мои слои»', () => {
      const props = renderPanel({ layersError: true, canCreateLayer: true });
      expect(screen.getByText('Не удалось загрузить слои')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(props.onRetryLayers).toHaveBeenCalled();
    });

    it('lists an imported layer and offers its export', () => {
      const imported = layer({ id: 'l2', title: 'Дороги', kind: 'imported', canEdit: false });
      const props = renderPanel({ drawnDefs: importedLayerDefs([imported]), canExport: true });
      expect(screen.getByText('Дороги')).toBeInTheDocument();
      // An imported layer is not drawable into — only exportable.
      expect(
        screen.queryByRole('button', { name: 'Рисовать в слое «Дороги»' }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать слой «Дороги»' }));
      expect(props.onExportLayer).toHaveBeenCalledWith(
        expect.objectContaining({ imported: expect.objectContaining({ id: 'l2' }) }),
      );
    });

    it('hides import/export actions without the permissions', () => {
      renderPanel({ drawnDefs: drawnLayerDefs([layer()]), canImport: false, canExport: false });
      expect(screen.queryByRole('button', { name: 'Импорт слоя' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Экспортировать слой «Оцепление»' }),
      ).not.toBeInTheDocument();
    });

    it('offers the import action with `gis.import`', () => {
      const props = renderPanel({ canImport: true });
      fireEvent.click(screen.getByRole('button', { name: 'Импорт слоя' }));
      expect(props.onImportLayer).toHaveBeenCalled();
    });

    it('hides the create action without `gis.layers.manage`', () => {
      renderPanel({ canCreateLayer: false });
      expect(screen.queryByRole('button', { name: 'Новый слой' })).not.toBeInTheDocument();
      renderPanel({ canCreateLayer: true });
      expect(screen.getByRole('button', { name: 'Новый слой' })).toBeInTheDocument();
    });
  });
});
