import type { FloatingReaction } from '../hooks/useReactions';

/** Ephemeral emoji reactions floating up over the stage (docs/modules/14 §3). */
export function ReactionsOverlay({
  reactions,
}: {
  reactions: FloatingReaction[];
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center gap-3">
      {reactions.map((r) => (
        <span key={r.id} className="meet-reaction text-4xl">
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
