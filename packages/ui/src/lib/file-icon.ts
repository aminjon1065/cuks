import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

/**
 * Pick a file-type icon from a MIME type (docs/06). Presentational helper shared
 * by {@link AttachmentList} and the files feature's node icon so both stay
 * visually consistent — one source of truth for the mime → icon mapping.
 */
export function fileIcon(mime: string | null | undefined): LucideIcon {
  const m = mime ?? '';
  if (m.startsWith('image/')) return FileImage;
  if (m.startsWith('video/')) return FileVideo;
  if (m.startsWith('audio/')) return FileAudio;
  if (m === 'application/pdf' || m.startsWith('text/')) return FileText;
  if (m.includes('zip') || m.includes('rar') || m.includes('tar') || m.includes('7z')) {
    return FileArchive;
  }
  return FileIcon;
}
