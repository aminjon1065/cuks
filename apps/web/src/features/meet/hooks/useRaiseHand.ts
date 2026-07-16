import { useCallback, useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

/** Raise/lower hand (docs/modules/14 §3). Uses a participant attribute so the flag persists for
 *  late-joiners and is readable on every tile/roster (`attributes.handRaised`). */
export function useRaiseHand(): { raised: boolean; toggle: () => void } {
  const { localParticipant } = useLocalParticipant();
  const [raised, setRaised] = useState(false);

  const toggle = useCallback(() => {
    setRaised((cur) => {
      const next = !cur;
      void localParticipant.setAttributes({ handRaised: next ? '1' : '' });
      return next;
    });
  }, [localParticipant]);

  return { raised, toggle };
}
