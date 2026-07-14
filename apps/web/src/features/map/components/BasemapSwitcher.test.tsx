import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import type { BasemapMode } from '../lib/basemap';
import { BasemapSwitcher } from './BasemapSwitcher';

function openSwitcher(value: BasemapMode = 'auto') {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <BasemapSwitcher value={value} onChange={onChange} />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Подложка' }));
  return onChange;
}

describe('BasemapSwitcher', () => {
  it('exposes the active basemap to assistive tech via aria-pressed', () => {
    openSwitcher('dark');
    expect(screen.getByRole('button', { name: 'Тёмная' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Схема' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'За темой' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('reports the chosen basemap mode', () => {
    const onChange = openSwitcher('auto');
    fireEvent.click(screen.getByRole('button', { name: 'Схема' }));
    expect(onChange).toHaveBeenCalledWith('light');
  });
});
