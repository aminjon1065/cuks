import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon,
} from 'lucide-react';
import type { FsNodeDto } from '@cuks/shared';

const DT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Dushanbe',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Format a UTC ISO instant in Asia/Dushanbe (CLAUDE.md: display TZ). */
export function formatDateTime(iso: string): string {
  return DT.format(new Date(iso));
}

/** Human-readable byte size (ru-RU grouping) — "12,5 МБ". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('ru-RU')} ${units[i]}`;
}

/** Icon for a node — folders get a folder, files an icon keyed off their mime. */
export function nodeIcon(node: Pick<FsNodeDto, 'kind' | 'mime'>): LucideIcon {
  if (node.kind === 'folder') return Folder;
  const mime = node.mime ?? '';
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime === 'application/pdf' || mime.startsWith('text/')) return FileText;
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('7z')) {
    return FileArchive;
  }
  return FileIcon;
}

/** True for a node whose current version can show an image preview tile. */
export function isImage(node: Pick<FsNodeDto, 'kind' | 'mime'>): boolean {
  return node.kind === 'file' && (node.mime ?? '').startsWith('image/');
}
