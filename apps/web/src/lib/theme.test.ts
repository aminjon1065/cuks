import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, useThemeStore } from './theme';

describe('theme', () => {
  beforeEach(() => {
    act(() => useThemeStore.getState().setTheme('system'));
  });

  it('resolves explicit preferences directly', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves system to light when the OS does not prefer dark', () => {
    // matchMedia is stubbed to matches: false in the test setup.
    expect(resolveTheme('system')).toBe('light');
  });

  it('updates the stored preference', () => {
    act(() => useThemeStore.getState().setTheme('dark'));
    expect(useThemeStore.getState().theme).toBe('dark');
  });
});
