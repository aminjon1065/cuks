import type { IncidentStatus } from '@cuks/shared';
import type { TokenResolver } from './map-config';

const STATUS_ICON_PREFIX = 'incident-status-';
const STATUS_ICON_RE =
  /^incident-status-(reported|active|localized|eliminated|closed)-sev-([1-5])$/;
const CLUSTER_COUNT_PREFIX = 'incident-cluster-count-';
const CLUSTER_COUNT_RE = /^incident-cluster-count-(\d+)$/;
const IMAGE_SIZE = 48;
const PIXEL_RATIO = 2;

export interface IncidentRuntimeImage {
  data: ImageData;
  pixelRatio: number;
}

/** Runtime sprite id used by the data-driven incident symbol layer. */
export function incidentStatusImageId(status: IncidentStatus, severity: number): string {
  return `${STATUS_ICON_PREFIX}${status}-sev-${severity}`;
}

export function incidentClusterCountImageId(count: number): string {
  return `${CLUSTER_COUNT_PREFIX}${Math.max(0, Math.trunc(count))}`;
}

function drawClosed(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(13, 13);
  ctx.lineTo(35, 35);
  ctx.moveTo(35, 13);
  ctx.lineTo(13, 35);
  ctx.stroke();
}

function drawStatusShape(ctx: CanvasRenderingContext2D, status: IncidentStatus): void {
  ctx.beginPath();
  switch (status) {
    case 'reported':
      ctx.arc(24, 24, 14, 0, Math.PI * 2);
      break;
    case 'active':
      ctx.arc(24, 24, 14, 0, Math.PI * 2);
      break;
    case 'localized':
      ctx.moveTo(24, 7);
      ctx.lineTo(41, 24);
      ctx.lineTo(24, 41);
      ctx.lineTo(7, 24);
      ctx.closePath();
      break;
    case 'eliminated':
      ctx.rect(10, 10, 28, 28);
      break;
    case 'closed':
      drawClosed(ctx);
      return;
  }
  ctx.fill();
  ctx.stroke();
}

/**
 * Build an offline MapLibre sprite on demand. The status controls geometry and
 * severity controls the fill token; no remote sprite or glyph endpoint is used.
 */
export function createIncidentStatusImage(
  id: string,
  token: TokenResolver,
): IncidentRuntimeImage | null {
  const match = STATUS_ICON_RE.exec(id);
  if (!match) return null;
  const status = match[1] as IncidentStatus;
  const severity = Number(match[2]);
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = token(`--sev-${severity}`);
  ctx.strokeStyle = token('--surface');
  ctx.lineWidth = status === 'closed' ? 9 : 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawStatusShape(ctx, status);

  // The active point is a bullseye as well as being surrounded by the animated
  // halo, so it remains distinct when reduced-motion is enabled.
  if (status === 'active') {
    ctx.beginPath();
    ctx.fillStyle = token('--surface');
    ctx.arc(24, 24, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return { data: ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE), pixelRatio: PIXEL_RATIO };
}

function rgb(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function luminance(value: string): number {
  const color = rgb(value);
  if (!color) return 0;
  const channels = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrastRatio(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function createClusterCountImage(id: string, token: TokenResolver): IncidentRuntimeImage | null {
  const match = CLUSTER_COUNT_RE.exec(id);
  if (!match) return null;
  const count = Number(match[1]);
  const width = count >= 100 ? 64 : 48;
  const height = 40;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Choose between theme tokens for contrast against the cluster's max-severity
  // color. The icon id intentionally carries only the count, so use the worst
  // contrast across all five severity tokens.
  const candidates = [token('--surface'), token('--text')];
  ctx.fillStyle = candidates.reduce((best, candidate) => {
    const candidateWorst = Math.min(
      ...[1, 2, 3, 4, 5].map((level) => contrastRatio(candidate, token(`--sev-${level}`))),
    );
    const bestWorst = Math.min(
      ...[1, 2, 3, 4, 5].map((level) => contrastRatio(best, token(`--sev-${level}`))),
    );
    return candidateWorst > bestWorst ? candidate : best;
  });
  ctx.font = '700 24px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), width / 2, height / 2 + 1);
  return { data: ctx.getImageData(0, 0, width, height), pixelRatio: PIXEL_RATIO };
}

/** Resolve any data-driven incident sprite requested by MapLibre. */
export function createIncidentRuntimeImage(
  id: string,
  token: TokenResolver,
): IncidentRuntimeImage | null {
  return createIncidentStatusImage(id, token) ?? createClusterCountImage(id, token);
}
