import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the design-system showcase', () => {
    render(<App />);
    expect(screen.getByTestId('ui-showcase')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Дизайн-система ЦУКС' })).toBeInTheDocument();
  });
});
