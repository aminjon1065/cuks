import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { LoginPage } from './LoginPage';

function renderLogin(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('renders the login form with translated labels', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Вход в систему' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Имя пользователя/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Пароль/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
  });

  it('hides the two-factor field until it is required', () => {
    renderLogin();
    expect(screen.queryByLabelText(/двухфакторной/)).not.toBeInTheDocument();
  });
});
