import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { Button } from '@cuks/ui';
import type { ChatMemberDto } from '@cuks/shared';
import { makeMentionSuggestion } from './mentionSuggestion';
import type { MentionItem } from './MentionList';

/** In-place rich editor for editing a message (docs/modules/13 §4). Seeded from the stored TipTap
 *  body; Enter saves, Shift+Enter/Escape behave as expected. It MUST register the same Mention node
 *  the composer uses — otherwise a stored body containing a mention hits an unknown-node-type error and
 *  TipTap v3 blanks the whole document. */
export function InlineEditor({
  body,
  members,
  pending,
  onSave,
  onCancel,
}: {
  body: unknown;
  members: ChatMemberDto[];
  pending: boolean;
  onSave: (body: unknown) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const membersRef = useRef<MentionItem[]>([]);
  membersRef.current = members.map((m) => ({ id: m.userId, label: m.name ?? m.userId }));
  const mentionOpenRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Mention.configure({
        HTMLAttributes: { class: 'chat-mention' },
        suggestion: makeMentionSuggestion(
          () => membersRef.current,
          (open) => {
            mentionOpenRef.current = open;
          },
          t('composer.mentionEmpty'),
        ),
      }),
    ],
    content: (body as object) ?? undefined,
    editorProps: {
      attributes: {
        class:
          'chat-composer max-h-40 overflow-y-auto rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-text',
        role: 'textbox',
        'aria-label': t('message.editLabel'),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !mentionOpenRef.current) {
          event.preventDefault();
          if (editor && !editor.isEmpty) onSave(editor.getJSON());
          return true;
        }
        if (event.key === 'Escape' && !mentionOpenRef.current) {
          event.preventDefault();
          onCancel();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editor?.commands.focus('end');
  }, [editor]);

  return (
    <div className="flex flex-col gap-1.5">
      <EditorContent editor={editor} />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => editor && !editor.isEmpty && onSave(editor.getJSON())}
          disabled={pending || !editor || editor.isEmpty}
        >
          {t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <span className="text-[11px] text-text-muted">{t('message.editHint')}</span>
      </div>
    </div>
  );
}
