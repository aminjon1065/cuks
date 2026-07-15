import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { IncidentMapFilterOptionsResponse } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { defaultIncidentFilters } from '../lib/incident-filters';
import { IncidentFilterBar } from './IncidentFilterBar';

const options: IncidentMapFilterOptionsResponse = {
  types: [
    {
      code: 'nat.hydro.flood',
      parentCode: 'nat.hydro',
      nameRu: 'Наводнение',
      nameTg: 'Наводнение',
      parentNameRu: 'Гидрологические',
      parentNameTg: 'Гидрологические',
    },
  ],
  regions: [
    { id: 'r1', code: 'TJ-DU', nameRu: 'Душанбе', nameTg: 'Душанбе' },
    { id: 'r2', code: 'TJ-KT', nameRu: 'Хатлон', nameTg: 'Хатлон' },
  ],
};

function renderBar(lockedRegionIds: readonly string[] | null = null) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <IncidentFilterBar
        value={{
          ...defaultIncidentFilters(new Date('2026-07-14T00:00:00Z')),
          regionId: lockedRegionIds ? (lockedRegionIds[0] as string) : '',
        }}
        options={options}
        loading={false}
        error={false}
        panelCollapsed={false}
        lockedRegionIds={lockedRegionIds}
        onChange={onChange}
        onReset={onReset}
        onRetry={vi.fn()}
      />
    </I18nextProvider>,
  );
  return { onChange, onReset };
}

describe('IncidentFilterBar', () => {
  it('renders accessible database-backed options and reports changes', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: 'Вид ЧС' }), {
      target: { value: 'nat.hydro.flood' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ typeCode: 'nat.hydro.flood' }));
    expect(screen.getByRole('option', { name: 'Гидрологические — Наводнение' })).toBeVisible();
  });

  it('keeps a reset action available with no optional filter selected', () => {
    const { onReset } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('pins the region select for a single-region confined user', () => {
    renderBar(['r2']);
    const regionSelect = screen.getByRole('combobox', { name: 'Регион' }) as HTMLSelectElement;
    expect(regionSelect).toBeDisabled();
    expect(regionSelect.value).toBe('r2');
    // Only the confined region — no "all regions" and no other region.
    expect(screen.getByRole('option', { name: 'Хатлон' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Все регионы' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Душанбе' })).toBeNull();
  });

  it('lets a multi-region confined user switch among their regions', () => {
    const { onChange } = renderBar(['r1', 'r2']);
    const regionSelect = screen.getByRole('combobox', { name: 'Регион' }) as HTMLSelectElement;
    // Interactive (incident tiles are per-region), but constrained to the scoped
    // regions — still no "all regions" escape hatch.
    expect(regionSelect).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Душанбе' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Хатлон' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Все регионы' })).toBeNull();
    fireEvent.change(regionSelect, { target: { value: 'r2' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ regionId: 'r2' }));
  });
});
