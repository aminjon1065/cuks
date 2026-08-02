import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { JobRunStatus } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { durationParts } from '../lib';
import { JobRunsSection } from './JobRunsSection';

/**
 * The operator's four questions about a scheduled sweep — did it run, when, how long, and did it
 * do anything — and the one answer that must not be faked: a job that never ran is not a job that
 * ran and found nothing.
 */

const ran = (over: Partial<Extract<JobRunStatus, { ran: true }>> = {}): JobRunStatus => ({
  job: 'deadlines',
  health: 'ok',
  ran: true,
  finishedAt: '2026-08-02T03:00:00.000Z',
  durationMs: 1_234,
  ok: true,
  counts: { scanned: 120, emitted: 4 },
  error: null,
  ...over,
});

const neverRan = (job: JobRunStatus['job']): JobRunStatus => ({
  job,
  health: 'unknown',
  ran: false,
  finishedAt: null,
  durationMs: null,
  ok: null,
  counts: null,
  error: null,
});

function renderSection(jobs: JobRunStatus[]): void {
  render(
    <I18nextProvider i18n={i18n}>
      <JobRunsSection jobs={jobs} />
    </I18nextProvider>,
  );
}

/** The card is the nearest block carrying the job's own name. */
function card(name: string): HTMLElement {
  const el = screen.getByText(name).closest('div.rounded-lg');
  if (!el) throw new Error(`no card for ${name}`);
  return el as HTMLElement;
}

describe('JobRunsSection', () => {
  it('reports a healthy run with its local time, duration and own counters', () => {
    renderSection([ran()]);

    const c = card('Сроки документов');
    expect(within(c).getByText('Норма')).toBeInTheDocument();
    // 03:00 UTC is 08:00 in Asia/Dushanbe — the timezone the whole app displays in.
    expect(within(c).getByText(/02\.08\.2026, 08:00/)).toBeInTheDocument();
    expect(within(c).getByText(/1,2 с/)).toBeInTheDocument();
    // Counters are the sweep's own units, but the interface is Russian: the processor's
    // identifiers must not reach the operator's screen.
    expect(within(c).getByText('Проверено резолюций')).toBeInTheDocument();
    expect(within(c).getByText('120')).toBeInTheDocument();
    expect(within(c).getByText('Напоминаний по резолюциям')).toBeInTheDocument();
    expect(c.textContent).not.toMatch(/scanned|emitted/);
  });

  it('separates a run that found nothing from a run that never happened', () => {
    // The pair this panel exists to keep apart. Same screen, same «0» everywhere — except one
    // card says «прошла, ничего не нашла» in counters and the other says «не запускалась».
    renderSection([
      ran({
        job: 'retention',
        counts: {
          purged: 0,
          abandoned: 0,
          reconciled: 0,
          expiredLinks: 0,
          recordingsPurged: 0,
          dispositionCandidates: 0,
        },
      }),
      neverRan('audit-maintenance'),
    ]);

    const swept = card('Сроки хранения');
    // Zeroes are shown, all six of them: the sweep reported them, and hiding them would make
    // «ничего не нашла» indistinguishable from «не запускалась».
    expect(within(swept).getAllByText('0')).toHaveLength(6);
    expect(within(swept).getByText('Очищено из корзины')).toBeInTheDocument();
    expect(within(swept).getByText('Кандидатов к выбытию')).toBeInTheDocument();
    // Present-and-zero is not «без счётчиков», and it is certainly not «ещё не запускалась».
    expect(within(swept).queryByText('Без счётчиков')).not.toBeInTheDocument();
    expect(within(swept).queryByText('Ещё не запускалась')).not.toBeInTheDocument();

    const never = card('Обслуживание журнала аудита');
    expect(within(never).getByText('Ещё не запускалась')).toBeInTheDocument();
    expect(never.textContent).not.toMatch(/\d/);
  });

  it('falls back to the raw counter name when a sweep reports one with no label yet', () => {
    // `counts` is open by contract, so a new sweep will report a counter this UI has never seen.
    // It must degrade to the processor's own English word — not to a bare i18next key path.
    renderSection([ran({ counts: { scanned: 5, quarantined: 2 } })]);

    const c = card('Сроки документов');
    expect(within(c).getByText('Проверено резолюций')).toBeInTheDocument();
    expect(within(c).getByText('quarantined')).toBeInTheDocument();
    expect(c.textContent).not.toMatch(/health\.jobs\.counter/);
  });

  it('reads a job that never ran as absence, not as zero', () => {
    renderSection([neverRan('retention')]);

    const c = card('Сроки хранения');
    expect(within(c).getByText('Ещё не запускалась')).toBeInTheDocument();
    expect(within(c).getByText('Нет данных')).toBeInTheDocument();
    // No duration, no counters, and above all no zeroes: «0» would claim a pass happened.
    expect(c.textContent).not.toMatch(/\d/);
  });

  it('shows the reason a run failed, not only that it did', () => {
    renderSection([
      ran({
        health: 'failed',
        ok: false,
        error: 'connect ECONNREFUSED 127.0.0.1:5432',
        counts: {},
      }),
    ]);

    const c = card('Сроки документов');
    expect(within(c).getByText('Сбой')).toBeInTheDocument();
    expect(within(c).getByText('connect ECONNREFUSED 127.0.0.1:5432')).toBeInTheDocument();
    expect(within(c).getByText('Без счётчиков')).toBeInTheDocument();
  });

  it('renders the verdict the API sent, not one derived from the age on screen', () => {
    // Both last ran on the same day; only the server knows that this is overdue for a daily sweep
    // and unremarkable for `0 3 1 * *`, so the panel must not second-guess the two labels.
    const finishedAt = '2026-07-30T03:00:00.000Z';
    renderSection([
      ran({ job: 'deadlines', health: 'stale', finishedAt }),
      ran({ job: 'audit-maintenance', health: 'ok', finishedAt }),
    ]);

    expect(within(card('Сроки документов')).getByText('Давно не выполнялась')).toBeInTheDocument();
    expect(within(card('Обслуживание журнала аудита')).getByText('Норма')).toBeInTheDocument();
  });

  it('says why the panel is empty instead of showing an empty grid', () => {
    renderSection([]);
    expect(screen.getByText('Нет данных о развёртках')).toBeInTheDocument();
  });
});

describe('durationParts', () => {
  it('keeps a sub-second sweep readable and a long one honest', () => {
    expect(durationParts(0)).toEqual({ unit: 'ms', value: 0 });
    expect(durationParts(940)).toEqual({ unit: 'ms', value: 940 });
    expect(durationParts(1_234)).toEqual({ unit: 'sec', value: 1.2 });
    expect(durationParts(59_900)).toEqual({ unit: 'sec', value: 59.9 });
    // Forty minutes is the case this panel was added for; it must not print as 2 400 000 мс.
    expect(durationParts(40 * 60_000)).toEqual({ unit: 'min', value: 40 });
  });
});
