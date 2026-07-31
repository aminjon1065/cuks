import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  Bold,
  Heading2,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  Table as TableIcon,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@cuks/ui';
import { isAllowedLinkHref, normalizeDocumentContent, type DocumentContent } from '@cuks/shared';

/** How long the editor stays quiet before persisting (docs/06 §1 — autosave, not a Save button). */
const AUTOSAVE_DEBOUNCE_MS = 1200;

export type ContentSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** The extension set is chosen to MATCH the storable allow-list, so what the editor can
 *  produce and what the server accepts stay one decision, not two that drift. */
function editorExtensions() {
  return [
    StarterKit.configure({
      // Off: each would emit a node the schema refuses, and there is no reason for a
      // document body to carry code, images or horizontal rules.
      code: false,
      codeBlock: false,
      horizontalRule: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: false,
        // TipTap's own guard, mirroring the server's: a link it cannot vouch for is
        // never turned into a mark in the first place.
        isAllowedUri: (url: string) => isAllowedLinkHref(url),
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-pressed={active ?? false}
          className={cn('size-8', active && 'bg-surface-2 text-text')}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const setLink = useCallback(() => {
    const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
    const href = window.prompt(t('content.linkPrompt'), previous);
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    // Refused here as well as on the server: the author is told immediately instead of
    // discovering it when the whole save fails.
    if (!isAllowedLinkHref(href.trim())) {
      window.alert(t('content.linkRejected'));
      return;
    }
    editor.chain().focus().setLink({ href: href.trim() }).run();
  }, [editor, t]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1 py-1">
      <ToolbarButton
        label={t('content.bold')}
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label={t('content.italic')}
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label={t('content.underline')}
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" aria-hidden />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label={t('content.heading')}
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label={t('content.bulletList')}
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label={t('content.orderedList')}
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label={t('content.blockquote')}
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" aria-hidden />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label={t('content.table')}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon className="size-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton label={t('content.link')} active={editor.isActive('link')} onClick={setLink}>
        <Link2 className="size-4" aria-hidden />
      </ToolbarButton>
      {editor.isActive('link') ? (
        <ToolbarButton
          label={t('content.unlink')}
          onClick={() => editor.chain().focus().unsetLink().run()}
        >
          <Link2Off className="size-4" aria-hidden />
        </ToolbarButton>
      ) : null}
    </div>
  );
}

/**
 * The document body editor (docs/modules/11 §12.7). Its extension set mirrors the storable
 * allow-list, and everything it produces goes through `normalizeDocumentContent` before it
 * leaves the browser — TipTap legitimately emits attributes the server refuses, and the
 * author should never see a 400 for using the toolbar.
 *
 * Saving is автосохранение: the editor persists after a quiet pause and reports its state,
 * so there is no Save button to forget. `readOnly` renders the same body without a toolbar.
 */
export function DocumentContentEditor({
  value,
  readOnly = false,
  onSave,
}: {
  value: DocumentContent | null;
  readOnly?: boolean;
  onSave?: (content: DocumentContent) => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [state, setState] = useState<ContentSaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const extensions = useMemo(editorExtensions, []);

  const persist = useCallback(async (content: DocumentContent) => {
    if (!onSaveRef.current) return;
    setState('saving');
    try {
      await onSaveRef.current(content);
      setState('saved');
    } catch {
      // Left as `error` rather than retried: a failed save is usually a version conflict
      // or a lost session, and silently retrying would fight the other editor.
      setState('error');
    }
  }, []);

  const editor = useEditor(
    {
      extensions,
      editable: !readOnly,
      // Built explicitly rather than spread: `content` is optional on DocumentContent, and
      // under exactOptionalPropertyTypes an absent key is not the same as an empty one.
      content: { type: 'doc', content: value?.content ?? [] },
      editorProps: {
        attributes: {
          class: cn(
            'prose-cuks min-h-40 px-3 py-2 text-[13px] text-text focus:outline-none',
            readOnly && 'min-h-0',
          ),
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('content.label'),
        },
      },
      onUpdate: ({ editor: instance }) => {
        if (readOnly || !onSaveRef.current) return;
        setState('dirty');
        if (timer.current) clearTimeout(timer.current);
        const snapshot = normalizeDocumentContent(instance.getJSON());
        timer.current = setTimeout(() => void persist(snapshot), AUTOSAVE_DEBOUNCE_MS);
      },
    },
    [extensions, readOnly],
  );

  // Flush a pending save when the editor goes away, so closing the card does not drop the
  // last keystrokes into the debounce window.
  useEffect(() => {
    return () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      if (editor && !readOnly && onSaveRef.current) {
        void persist(normalizeDocumentContent(editor.getJSON()));
      }
    };
  }, [editor, persist, readOnly]);

  if (!editor) return <div className="h-40 rounded-sm border border-border" />;

  return (
    <div className="rounded-sm border border-border bg-surface">
      {readOnly ? null : <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      {readOnly ? null : (
        <div className="flex justify-end border-t border-border px-3 py-1">
          <span
            role="status"
            aria-live="polite"
            className={cn('text-xs', state === 'error' ? 'text-danger' : 'text-text-muted')}
          >
            {t(`content.state.${state}`)}
          </span>
        </div>
      )}
    </div>
  );
}
