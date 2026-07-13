import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentList, type AttachmentItem } from './attachment-list';
import { FileDropzone } from './file-dropzone';

function makeFile(name = 'a.txt'): File {
  return new File(['content'], name, { type: 'text/plain' });
}

describe('FileDropzone', () => {
  it('emits files selected through the hidden input', () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDropzone onFiles={onFiles} label="Drop here" />);
    expect(screen.getByText('Drop here')).toBeInTheDocument();
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('emits files dropped onto the area', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} label="Drop here" data-testid="dz" />);
    fireEvent.drop(screen.getByTestId('dz'), { dataTransfer: { files: [makeFile()] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('caps at one file when multiple=false', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} multiple={false} data-testid="dz" />);
    fireEvent.drop(screen.getByTestId('dz'), {
      dataTransfer: { files: [makeFile('a.txt'), makeFile('b.txt')] },
    });
    expect(onFiles.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('ignores drops when disabled', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} disabled data-testid="dz" />);
    fireEvent.drop(screen.getByTestId('dz'), { dataTransfer: { files: [makeFile()] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('stops the drop from bubbling to an ancestor drop handler', () => {
    const onFiles = vi.fn();
    const ancestorDrop = vi.fn();
    render(
      <div onDrop={ancestorDrop}>
        <FileDropzone onFiles={onFiles} data-testid="dz" />
      </div>,
    );
    fireEvent.drop(screen.getByTestId('dz'), { dataTransfer: { files: [makeFile()] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    // The ancestor must NOT also receive the drop (would double-upload).
    expect(ancestorDrop).not.toHaveBeenCalled();
  });
});

describe('AttachmentList', () => {
  const uploading: AttachmentItem = { id: '1', name: 'up.txt', status: 'uploading', progress: 0.4 };
  const done: AttachmentItem = { id: '2', name: 'done.txt', status: 'done', mime: 'text/plain' };
  const failed: AttachmentItem = { id: '3', name: 'bad.txt', status: 'error', error: 'boom' };

  it('renders each item name and error text', () => {
    render(<AttachmentList items={[uploading, done, failed]} />);
    expect(screen.getByText('up.txt')).toBeInTheDocument();
    expect(screen.getByText('done.txt')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('exposes an accessible progressbar while uploading', () => {
    render(<AttachmentList items={[uploading]} labels={{ uploading: 'Загрузка' }} />);
    const bar = screen.getByRole('progressbar', { name: 'Загрузка' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('calls onRemove for the clicked row', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<AttachmentList items={[done]} onRemove={onRemove} labels={{ remove: 'Remove' }} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('2');
  });

  it('offers download only for finished items and opens on click', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <AttachmentList
        items={[uploading, done]}
        onDownload={onDownload}
        labels={{ download: 'Download' }}
      />,
    );
    // Only the finished row exposes a download action.
    const buttons = screen.getAllByRole('button', { name: 'Download' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0] as HTMLElement);
    expect(onDownload).toHaveBeenCalledWith('2');
  });

  it('opens a finished item via onOpen', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<AttachmentList items={[done]} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'done.txt' }));
    expect(onOpen).toHaveBeenCalledWith('2');
  });
});
