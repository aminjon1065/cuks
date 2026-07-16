import { useEffect } from 'react';

/**
 * A soft repeating ringtone for an incoming call (docs/modules/14 §2, «мелодия»), synthesized with
 * WebAudio so no audio asset ships. Autoplay policy may keep it silent until the tab has had a user
 * gesture — the visual prompt is the primary cue; the tone is best-effort.
 */
export function useRingtone(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | null = null;
    let timer: number | null = null;
    try {
      ctx = new AudioContext();
      const beep = (): void => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 480;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        osc.start(now);
        osc.stop(now + 1);
      };
      void ctx.resume();
      beep();
      timer = window.setInterval(beep, 2000);
    } catch {
      // WebAudio unavailable / blocked — the visual prompt still shows.
    }
    return () => {
      if (timer) window.clearInterval(timer);
      void ctx?.close();
    };
  }, [active]);
}
