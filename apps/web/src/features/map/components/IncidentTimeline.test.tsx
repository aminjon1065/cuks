import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import type { IncidentFilterState } from '../lib/incident-filters';
import { IncidentTimeline } from './IncidentTimeline';

const initial: IncidentFilterState = {
  typeCode: '',
  status: '',
  regionId: '',
  dateFrom: '2026-07-01',
  dateTo: '2026-07-03',
  cursorDate: '2026-07-03',
};

function Harness(): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <IncidentTimeline value={value} onChange={setValue} />;
}

function renderTimeline(): void {
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
}

describe('IncidentTimeline', () => {
  afterEach(() => vi.useRealTimers());

  it('exposes labelled date inputs and an accessible timeline slider', () => {
    renderTimeline();
    expect(screen.getByLabelText('Период с')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('по')).toHaveValue('2026-07-03');
    expect(screen.getByRole('slider', { name: 'Дата таймлайна' })).toBeVisible();
  });

  it('restarts at the beginning and advances one local day while playing', () => {
    vi.useFakeTimers();
    renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Запустить анимацию' }));
    expect(screen.getByText('01.07.2026')).toBeVisible();
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByText('02.07.2026')).toBeVisible();
  });

  it('keeps the cursor inside a one-day range for keyboard input', () => {
    const onChange = vi.fn();
    const oneDay = {
      ...initial,
      dateFrom: '2026-07-14',
      dateTo: '2026-07-14',
      cursorDate: '2026-07-14',
    };
    render(
      <I18nextProvider i18n={i18n}>
        <IncidentTimeline value={oneDay} onChange={onChange} />
      </I18nextProvider>,
    );

    const slider = screen.getByRole('slider', { name: 'Дата таймлайна' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('14.07.2026')).toBeVisible();
  });
});
