import { AppException } from '../../common/exceptions/app.exception';

/** Keyset cursor for chat lists = base64url of `<createdAt ISO>|<id>` — a stable `(created_at, id)`
 *  anchor shared by the message feed and search (docs/modules/13 §5). */
export function encodeCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!iso || !id) throw AppException.badRequest('chat.cursor.invalid', 'Invalid cursor');
  return { createdAt: new Date(iso), id };
}
