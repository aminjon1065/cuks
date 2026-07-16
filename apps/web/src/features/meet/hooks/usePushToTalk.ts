import { useEffect, useRef, useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

/** True while the user holds Space to talk. */
function isEditableTarget(el: Element | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}

/**
 * Push-to-talk (docs/modules/14 §3): hold Space to temporarily un-mute, release to mute again. Only
 * engages when the mic is currently muted, and ignores Space typed into inputs. Returns whether the
 * user is currently push-talking (for a control-bar hint).
 */
export function usePushToTalk(): boolean {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || isEditableTarget(document.activeElement)) return;
      if (isMicrophoneEnabled || talkingRef.current) return;
      e.preventDefault();
      talkingRef.current = true;
      setTalking(true);
      void localParticipant.setMicrophoneEnabled(true);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || !talkingRef.current) return;
      e.preventDefault();
      talkingRef.current = false;
      setTalking(false);
      void localParticipant.setMicrophoneEnabled(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [localParticipant, isMicrophoneEnabled]);

  return talking;
}
