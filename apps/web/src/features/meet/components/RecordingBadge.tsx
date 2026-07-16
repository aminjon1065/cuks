import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsRecording } from '@livekit/components-react';
import { Circle } from 'lucide-react';
import { toast } from '@cuks/ui';

/**
 * The recording indicator visible to EVERYONE (docs/modules/14 §3, hard requirement), plus a system
 * announcement toast when recording starts/stops. Driven by LiveKit's room recording state, which
 * flips when Egress runs (task 6.6).
 */
export function RecordingBadge(): React.JSX.Element | null {
  const { t } = useTranslation('meet');
  const isRecording = useIsRecording();
  const prev = useRef(isRecording);

  useEffect(() => {
    if (prev.current !== isRecording) {
      toast({
        title: isRecording ? t('toast.recordingStarted') : t('toast.recordingStopped'),
      });
      prev.current = isRecording;
    }
  }, [isRecording, t]);

  if (!isRecording) return null;
  return (
    <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-danger px-3 py-1 text-[12px] font-medium text-white shadow-sm">
      <Circle className="size-2.5 animate-pulse fill-current" />
      {t('room.recording')}
    </div>
  );
}
