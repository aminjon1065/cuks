import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@cuks/ui';
import { documentContentSchema, type DocumentContent } from '@cuks/shared';
import i18n from '@/lib/i18n';
import { DocumentContentEditor } from './DocumentContentEditor';

/** A body using every block the storable allow-list permits. */
const RICH: DocumentContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Заголовок' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Абзац с ' },
        {
          type: 'text',
          text: 'ссылкой',
          marks: [{ type: 'link', attrs: { href: 'https://cuks.local' } }],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Пункт' }] }],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Шапка' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ячейка' }] }],
            },
          ],
        },
      ],
    },
  ],
};

function renderEditor(props: Partial<Parameters<typeof DocumentContentEditor>[0]> = {}): void {
  render(
    // The app mounts a TooltipProvider at the root (app/providers.tsx); the toolbar's
    // tooltips need one, so the test supplies the same ancestor.
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <DocumentContentEditor value={RICH} readOnly {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe('DocumentContentEditor', () => {
  it('renders every block the storable allow-list permits', async () => {
    // Guards the pairing that matters: the extension set must be able to parse exactly
    // what the server accepts, or a valid document would come back blank.
    expect(documentContentSchema.safeParse(RICH).success).toBe(true);
    renderEditor();
    for (const text of ['Заголовок', 'Абзац с', 'ссылкой', 'Пункт', 'Шапка', 'Ячейка']) {
      expect(await screen.findByText(new RegExp(text)), text).toBeInTheDocument();
    }
  });

  it('offers no toolbar in read-only mode', async () => {
    renderEditor();
    await screen.findByText(/Заголовок/);
    expect(screen.queryByRole('button', { name: 'Жирный' })).toBeNull();
    // Nor a save-state line — nothing is being saved.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the toolbar and the autosave state when editable', async () => {
    renderEditor({ readOnly: false, onSave: vi.fn().mockResolvedValue(undefined) });
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Жирный' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вставить таблицу' })).toBeInTheDocument();
    // The save state is a live region, so a screen reader hears «Сохранено» without focus.
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
