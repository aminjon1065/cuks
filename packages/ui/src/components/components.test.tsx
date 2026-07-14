import type { ColumnDef } from '@tanstack/react-table';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';
import { DataTable } from './data-table';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { EmptyState } from './empty-state';
import { SeverityBadge } from './severity-badge';
import { StatusBadge } from './status-badge';
import { dismissToast, toast, Toaster } from './toast';

describe('badges', () => {
  it('StatusBadge renders its label', () => {
    render(<StatusBadge tone="success" label="Исполнено" />);
    expect(screen.getByText('Исполнено')).toBeInTheDocument();
  });

  it('SeverityBadge renders the level label', () => {
    render(<SeverityBadge level={4} label="Республиканский" />);
    expect(screen.getByText('Республиканский')).toBeInTheDocument();
  });

  it('Badge applies tone classes', () => {
    render(<Badge tone="danger">Просрочено</Badge>);
    expect(screen.getByText('Просрочено').className).toContain('text-danger');
  });
});

describe('Button', () => {
  it('renders as a child element with asChild', () => {
    render(
      <Button asChild>
        <a href="/x">Ссылка</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Ссылка' });
    expect(link).toBeInTheDocument();
    expect(link.className).toContain('bg-primary');
  });
});

describe('Toaster', () => {
  it('keeps danger toasts accessible while a modal dialog is open', () => {
    render(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Изменение статуса</DialogTitle>
          </DialogContent>
        </Dialog>
        <Toaster />
      </>,
    );

    let toastId = '';
    act(() => {
      toastId = toast({ title: 'Конфликт статуса', tone: 'danger' });
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Конфликт статуса');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert.closest('[aria-hidden="true"]')).toBeNull();

    act(() => dismissToast(toastId));
  });
});

interface Row {
  name: string;
  age: number;
}
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Имя' },
  { accessorKey: 'age', header: 'Возраст' },
];

describe('DataTable', () => {
  it('renders rows', () => {
    render(<DataTable columns={columns} data={[{ name: 'Иванов', age: 40 }]} />);
    expect(screen.getByText('Иванов')).toBeInTheDocument();
  });

  it('shows the empty slot when there is no data', () => {
    render(<DataTable columns={columns} data={[]} empty={<EmptyState title="Нет данных" />} />);
    expect(screen.getByText('Нет данных')).toBeInTheDocument();
  });

  it('sorts when a header is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={[
          { name: 'Борис', age: 30 },
          { name: 'Анна', age: 20 },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Имя/ }));
    const rows = screen.getAllByRole('row');
    // rows[0] is the header; first data row should now be 'Анна' (asc).
    expect(within(rows[1] as HTMLElement).getByText('Анна')).toBeInTheDocument();
  });

  it('focuses an interactive row and invokes the Enter callback', async () => {
    const user = userEvent.setup();
    const onRowEnter = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[{ name: 'Анна', age: 20 }]}
        onRowClick={() => undefined}
        onRowEnter={onRowEnter}
      />,
    );

    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveAttribute('tabindex', '0');
    row.focus();
    await user.keyboard('{Enter}');
    expect(onRowEnter).toHaveBeenCalledWith({ name: 'Анна', age: 20 });
  });
});
