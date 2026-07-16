import { Popover, PopoverContent, PopoverTrigger } from '@cuks/ui';
import { CHAT_REACTION_EMOJI } from '@cuks/shared';

/** The fixed reaction palette (docs/modules/13 §4) in a popover; picking one calls `onPick`. */
export function EmojiPicker({
  trigger,
  onPick,
  align = 'start',
}: {
  trigger: React.ReactNode;
  onPick: (emoji: string) => void;
  align?: 'start' | 'center' | 'end';
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-1.5">
        <div className="grid grid-cols-10 gap-0.5">
          {CHAT_REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="flex size-7 items-center justify-center rounded-sm text-base hover:bg-surface-2"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
