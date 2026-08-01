import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type { DispatchChannel } from '@cuks/shared';
import type {
  DocumentExchangePort,
  ExchangeProbeResult,
  ExchangeSendResult,
  InboundExchangeMessage,
  OutboundExchangeMessage,
} from './document-exchange-port';

/**
 * The reference adapter (plan этап 10 «локальная папка/внутренний HTTP mock»).
 *
 * A watched directory on the same server: outgoing letters are written into `out/`, incoming
 * ones are read from `in/`. No network, no external service, nothing to configure but a path —
 * which is exactly what makes it the right first adapter for an isolated installation, and
 * what makes the whole exchange contour testable without pretending to have a departmental
 * transport that nobody has specified yet.
 *
 * It is also a real adapter, not a mock: an operator can drop a scanned letter into `in/` and
 * it will arrive in the register, and a courier service that watches `out/` will find the
 * letters waiting. Where a transport later appears, it replaces this class and nothing else.
 */
export class FolderExchangeAdapter implements DocumentExchangePort {
  private readonly logger = new Logger(FolderExchangeAdapter.name);
  readonly channel: DispatchChannel = 'integration';
  readonly title = 'Локальная папка обмена';

  constructor(
    readonly id: string,
    /** Root of the exchange directory; `in/`, `out/` and `done/` live under it. */
    private readonly root: string,
    /** Refuse anything larger — a transport folder is not a place to receive a DVD image. */
    private readonly maxAttachmentBytes: number,
  ) {}

  private dir(kind: 'in' | 'out' | 'done' | 'rejected'): string {
    return join(this.root, kind);
  }

  async probe(): Promise<ExchangeProbeResult> {
    try {
      // Writable, not merely present: a read-only mount looks perfectly healthy until the
      // first send, and «здоров» that only holds for reads is worse than no status at all.
      await mkdir(this.dir('out'), { recursive: true });
      await access(this.dir('out'), constants.W_OK);
      await mkdir(this.dir('in'), { recursive: true });
      await access(this.dir('in'), constants.R_OK);
      return { reachable: true, detail: `Каталог обмена доступен: ${this.root}` };
    } catch (error) {
      // The path is not a secret and naming it is the whole value of the message; the error
      // text is truncated because a filesystem error can carry an environment-shaped tail.
      return {
        reachable: false,
        detail: `Каталог обмена недоступен: ${String(error).slice(0, 200)}`,
      };
    }
  }

  async send(message: OutboundExchangeMessage): Promise<ExchangeSendResult> {
    try {
      await mkdir(this.dir('out'), { recursive: true });
      // Named by the dispatch attempt, so a folder full of letters can be correlated back to
      // the register by eye as well as by the receipt.
      const stem = `${safeStem(message.regNumber ?? message.documentId)}-${message.dispatchId.slice(0, 8)}`;
      const envelope = {
        dispatchId: message.dispatchId,
        documentId: message.documentId,
        regNumber: message.regNumber,
        subject: message.subject,
        recipientName: message.recipientName,
        recipientAddress: message.recipientAddress,
        attachments: message.attachments.map((a) => ({
          fileName: a.fileName,
          contentType: a.contentType,
          bytes: a.body.length,
        })),
      };
      await writeFile(join(this.dir('out'), `${stem}.json`), JSON.stringify(envelope, null, 2));
      for (const [i, attachment] of message.attachments.entries()) {
        const name = `${stem}-${i + 1}-${safeStem(attachment.fileName)}${extname(attachment.fileName)}`;
        await writeFile(join(this.dir('out'), name), attachment.body);
      }

      // The receipt is the envelope we wrote plus its checksum — a technical acknowledgement
      // with no secret in it, which is what plan §6.8 asks a machine channel to keep.
      const receiptBody = Buffer.from(
        JSON.stringify(
          {
            ...envelope,
            writtenAt: new Date().toISOString(),
            checksum: createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),
          },
          null,
          2,
        ),
      );
      return {
        ok: true,
        externalReference: stem,
        receipt: {
          fileName: `${stem}-receipt.json`,
          contentType: 'application/json',
          body: receiptBody,
        },
      };
    } catch (error) {
      // A full or unmounted disk is worth retrying; a bad path is not, but the adapter cannot
      // tell them apart from an errno alone, so it says «retryable» and lets the attempt cap
      // decide. Giving up early on a transient fault loses letters; retrying a permanent one
      // costs a few rows and surfaces in the dead-letter list either way.
      return {
        ok: false,
        retryable: true,
        failureCode: 'folder.write_failed',
        detail: String(error).slice(0, 300),
      };
    }
  }

  /**
   * Everything currently sitting in `in/`. Attachments are the files beside the envelope,
   * matched by the envelope naming it — never by scanning the directory, or two letters
   * arriving at once would steal each other's pages.
   */
  async poll(): Promise<InboundExchangeMessage[]> {
    let entries: string[];
    try {
      await mkdir(this.dir('in'), { recursive: true });
      entries = await readdir(this.dir('in'));
    } catch (error) {
      this.logger.warn(`exchange folder unreadable: ${String(error).slice(0, 200)}`);
      return [];
    }

    const messages: InboundExchangeMessage[] = [];
    for (const entry of entries.filter((e) => e.toLowerCase().endsWith('.json'))) {
      const parsed = await this.readEnvelope(entry);
      if (parsed) messages.push(parsed);
    }
    return messages;
  }

  async acknowledge(externalId: string, outcome: 'accepted' | 'rejected'): Promise<void> {
    const target = outcome === 'accepted' ? this.dir('done') : this.dir('rejected');
    try {
      await mkdir(target, { recursive: true });
      // Moved, not deleted: an operator must be able to see what arrived and what was refused,
      // and a rejected letter that vanished is one nobody can investigate.
      const envelope = `${externalId}.json`;
      await rename(join(this.dir('in'), envelope), join(target, envelope));
      for (const name of await readdir(this.dir('in'))) {
        if (name.startsWith(`${externalId}-`)) {
          await rename(join(this.dir('in'), name), join(target, name));
        }
      }
    } catch (error) {
      // A message that cannot be moved will be polled again and deduplicated by its external
      // id, so this is a warning rather than a failure.
      this.logger.warn(`could not archive ${externalId}: ${String(error).slice(0, 200)}`);
    }
  }

  private async readEnvelope(entry: string): Promise<InboundExchangeMessage | null> {
    const externalId = basename(entry, '.json');
    try {
      const raw = await readFile(join(this.dir('in'), entry), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const env = parsed as Record<string, unknown>;
      const subject = typeof env.subject === 'string' ? env.subject.slice(0, 500) : '';
      if (!subject) return null;

      const attachments = [];
      for (const name of Array.isArray(env.attachments) ? env.attachments : []) {
        if (typeof name !== 'string') continue;
        const path = resolve(this.dir('in'), name);
        // A path that escapes the inbox is not an attachment, whatever the envelope calls it:
        // `../../etc/passwd` in a JSON field must not become a document file.
        if (!path.startsWith(resolve(this.dir('in')))) {
          this.logger.warn(`attachment path outside the inbox in ${entry}: ${name}`);
          continue;
        }
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) continue;
        if (info.size > this.maxAttachmentBytes) {
          this.logger.warn(`attachment ${name} exceeds the exchange limit; skipped`);
          continue;
        }
        attachments.push({
          fileName: basename(name),
          contentType: guessContentType(name),
          body: await readFile(path),
        });
      }

      return {
        externalId,
        subject,
        senderName: typeof env.senderName === 'string' ? env.senderName.slice(0, 300) : null,
        senderContact:
          typeof env.senderContact === 'string' ? env.senderContact.slice(0, 200) : null,
        sentAt: typeof env.sentAt === 'string' ? parseDate(env.sentAt) : null,
        summary: typeof env.summary === 'string' ? env.summary.slice(0, 2000) : null,
        attachments,
      };
    } catch (error) {
      this.logger.warn(`unreadable envelope ${entry}: ${String(error).slice(0, 200)}`);
      return null;
    }
  }
}

/** A file-name stem that is safe on every filesystem and still recognisable to a person. */
function safeStem(value: string): string {
  return (
    value
      .replace(/\.[^.]+$/, '')
      .replace(/[^\p{L}\p{N}-]+/gu, '_')
      .slice(0, 60) || 'doc'
  );
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Enough to label the file; the real type check is the caller's MIME allow-list. */
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain',
};

function guessContentType(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}
