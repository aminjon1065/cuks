import { useCallback, useMemo, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';

export interface FloatingReaction {
  id: string;
  identity: string;
  emoji: string;
}

const TOPIC = 'meet-reactions';
const LIFETIME_MS = 4000;

/** Ephemeral emoji reactions over the LiveKit data channel (docs/modules/14 §3, «реакции»). Own
 *  reactions are shown locally immediately; others' arrive over the channel. */
export function useReactions(): {
  reactions: FloatingReaction[];
  react: (emoji: string) => void;
} {
  const { localParticipant } = useLocalParticipant();
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const encoder = useMemo(() => new TextEncoder(), []);
  const decoder = useMemo(() => new TextDecoder(), []);
  const seq = useRef(0);

  const show = useCallback((identity: string, emoji: string) => {
    const id = `${identity}-${(seq.current += 1)}`;
    setReactions((cur) => [...cur, { id, identity, emoji }]);
    setTimeout(() => setReactions((cur) => cur.filter((r) => r.id !== id)), LIFETIME_MS);
  }, []);

  const { send } = useDataChannel(TOPIC, (msg) => {
    try {
      const data = JSON.parse(decoder.decode(msg.payload)) as { emoji?: string };
      if (data.emoji && msg.from) show(msg.from.identity, data.emoji);
    } catch {
      // Ignore malformed data-channel payloads.
    }
  });

  const react = useCallback(
    (emoji: string) => {
      show(localParticipant.identity, emoji);
      void send(encoder.encode(JSON.stringify({ emoji })), { reliable: true, topic: TOPIC });
    },
    [encoder, localParticipant.identity, send, show],
  );

  return { reactions, react };
}
