import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { defaultLayerStates } from '../lib/layers';
import { LayersPanel, type LayersPanelProps } from './LayersPanel';

const ALL_SOURCES = new Set(['admin_units', 'facilities', 'risk_zones', 'layer_features']);

function renderPanel(overrides: Partial<LayersPanelProps> = {}) {
  const props: LayersPanelProps = {
    states: defaultLayerStates(),
    availableSources: ALL_SOURCES,
    collapsed: false,
    onCollapsedChange: vi.fn(),
    onToggle: vi.fn(),
    onOpacity: vi.fn(),
    onZoom: vi.fn(),
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
    renderPanel();
    expect(screen.getByText('Границы')).toBeInTheDocument();
    expect(screen.getByText('Инфраструктура')).toBeInTheDocument();
    expect(screen.getByText('Риски')).toBeInTheDocument();
    expect(screen.getByText('Мои слои')).toBeInTheDocument();
    expect(screen.getByText('Административные границы')).toBeInTheDocument();
  });

  it('reflects default visibility on the checkboxes', () => {
    renderPanel();
    expect(screen.getByRole('checkbox', { name: 'Административные границы' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Зоны риска' })).not.toBeChecked();
  });

  it('toggles a layer through the checkbox', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Административные границы' }));
    expect(props.onToggle).toHaveBeenCalledWith('admin_units', false);
  });

  it('requests zoom-to-layer with the layer source', () => {
    const props = renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: /Приблизить к слою «Объекты инфраструктуры»/ }),
    );
    expect(props.onZoom).toHaveBeenCalledWith('facilities');
  });

  it('shows opacity + legend only for visible layers', () => {
    renderPanel();
    // admin_units is visible by default → its legend label renders.
    expect(screen.getByText('Границы регионов')).toBeInTheDocument();
    // risk_zones is hidden by default → its legend label does not.
    expect(screen.queryByText('Зона риска')).not.toBeInTheDocument();
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
});
