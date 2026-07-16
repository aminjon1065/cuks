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
    // Force-mute if we're currently push-talking. Used by keyup AND by any focus-loss path, so the
    // mic can never stay hot after a keyup the window never receives (Alt-Tab, an OS dialog, etc.).
    const release = (): void => {
      if (!talkingRef.current) return;
      talkingRef.current = false;
      setTalking(false);
      void localParticipant.setMicrophoneEnabled(false);
    };
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
      release();
    };
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onHidden);
      // Never leave the mic broadcasting when the hook unmounts mid-hold.
      if (talkingRef.current) {
        talkingRef.current = false;
        void localParticipant.setMicrophoneEnabled(false);
      }
    };
  }, [localParticipant, isMicrophoneEnabled]);

  return talking;
}
