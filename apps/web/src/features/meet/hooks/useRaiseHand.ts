import { useCallback } from 'react';
import { useLocalParticipant, useParticipantAttribute } from '@livekit/components-react';

/** Raise/lower hand (docs/modules/14 §3). Uses a participant attribute so the flag persists for
 *  late-joiners and is readable on every tile/roster (`attributes.handRaised`).
 *
 *  `raised` is derived from the ATTRIBUTE, not an optimistic local state: the SFU
 *  echoes `setAttributes` back, so the button reflects what other participants
 *  actually see — a silently-failed update no longer leaves a lying button. The
 *  toggle rejects on failure so the caller can surface it (toast). */
export function useRaiseHand(): { raised: boolean; toggle: () => Promise<void> } {
  const { localParticipant } = useLocalParticipant();
  const raised = useParticipantAttribute('handRaised', { participant: localParticipant }) === '1';

  const toggle = useCallback(async () => {
    await localParticipant.setAttributes({ handRaised: raised ? '' : '1' });
  }, [localParticipant, raised]);

  return { raised, toggle };
}
