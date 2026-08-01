import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderExchangeAdapter } from './folder-exchange.adapter';

/**
 * The contract tests the plan asks for (§этап 10 «contract tests»), run against the reference
 * adapter — a real directory, not a mock, because the interesting failures here are
 * filesystem-shaped: an unwritable mount, a path that escapes the inbox, a file too large.
 */
const MAX_BYTES = 1024;
let root: string;
let adapter: FolderExchangeAdapter;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cuks-exchange-'));
  adapter = new FolderExchangeAdapter('folder', root, MAX_BYTES);
});
afterEach(() => {
  // The temp directory is left for the OS: removing it here would race the adapter's own
  // mkdir on a slow filesystem and make the suite flaky for no benefit.
});

const message = {
  dispatchId: '019fbb96-653c-7c17-bcf5-c4b0eacf8439',
  documentId: '019fbb96-0000-7c17-bcf5-c4b0eacf8439',
  regNumber: 'П-2026/0001',
  subject: 'О мерах',
  recipientName: 'Хукумат г. Душанбе',
  recipientAddress: 'пр. Рудаки, 42',
  attachments: [
    { fileName: 'letter.pdf', contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') },
  ],
};

describe('FolderExchangeAdapter — probe', () => {
  it('reports the directory it is watching, and creates it if absent', async () => {
    const probe = await adapter.probe();
    expect(probe.reachable).toBe(true);
    expect(probe.detail).toContain(root);
  });

  it('reports unreachable rather than throwing when the path cannot be used', async () => {
    // A path under a FILE cannot be a directory — the closest portable stand-in for an
    // unmounted or read-only share.
    const file = join(root, 'not-a-dir');
    await writeFile(file, 'x');
    const broken = new FolderExchangeAdapter('folder', join(file, 'nested'), MAX_BYTES);
    const probe = await broken.probe();
    expect(probe.reachable).toBe(false);
    expect(probe.detail).toBeTruthy();
  });
});

describe('FolderExchangeAdapter — send', () => {
  it('writes the envelope and the attachments, and returns a correlatable receipt', async () => {
    const result = await adapter.send(message);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = await readdir(join(root, 'out'));
    expect(
      written.some((f) => f.endsWith('.json')),
      'an envelope',
    ).toBe(true);
    expect(
      written.some((f) => f.endsWith('.pdf')),
      'the attachment',
    ).toBe(true);

    // The receipt carries the dispatch id, which is what correlates it back to the attempt
    // when the operator opens the card («outbound receipt correlation»).
    expect(result.receipt).toBeTruthy();
    const receipt = JSON.parse(result.receipt!.body.toString('utf8')) as { dispatchId: string };
    expect(receipt.dispatchId).toBe(message.dispatchId);
    expect(result.externalReference).toContain('2026');
  });

  it('keeps no secret in the receipt — only the envelope it wrote', async () => {
    const result = await adapter.send(message);
    if (!result.ok || !result.receipt) throw new Error('expected a receipt');
    const text = result.receipt.body.toString('utf8');
    for (const forbidden of ['password', 'secret', 'token', 'cookie', 'authorization']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('fails retryably instead of throwing when the folder cannot be written', async () => {
    const file = join(root, 'blocked');
    await writeFile(file, 'x');
    const broken = new FolderExchangeAdapter('folder', join(file, 'nested'), MAX_BYTES);
    const result = await broken.send(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // «Отказ внешней системы не ломает основной API»: an unusable transport is a result the
    // caller can record and retry, never an exception that reaches the request.
    expect(result.retryable).toBe(true);
    expect(result.failureCode).toBe('folder.write_failed');
  });
});

describe('FolderExchangeAdapter — poll', () => {
  const drop = async (name: string, envelope: unknown): Promise<void> => {
    await mkdir(join(root, 'in'), { recursive: true });
    await writeFile(join(root, 'in', `${name}.json`), JSON.stringify(envelope));
  };

  it('reads an envelope and names the message by its file', async () => {
    await drop('msg-1', { subject: 'Входящее письмо', senderName: 'Хукумат', attachments: [] });
    const [msg] = await adapter.poll();
    expect(msg?.externalId).toBe('msg-1');
    expect(msg?.subject).toBe('Входящее письмо');
    expect(msg?.senderName).toBe('Хукумат');
  });

  it('returns nothing for an envelope with no subject — there is no document in it', async () => {
    await drop('msg-2', { senderName: 'Кто-то' });
    expect(await adapter.poll()).toEqual([]);
  });

  it('survives an unparseable envelope instead of failing the whole poll', async () => {
    await mkdir(join(root, 'in'), { recursive: true });
    await writeFile(join(root, 'in', 'broken.json'), '{ not json');
    await drop('msg-3', { subject: 'Читаемое' });
    const messages = await adapter.poll();
    // One bad file must not stop the rest arriving: an operator dropping a malformed envelope
    // would otherwise silently block every letter behind it.
    expect(messages.map((m) => m.externalId)).toEqual(['msg-3']);
  });

  it('refuses an attachment path that escapes the inbox', async () => {
    await writeFile(join(root, 'secret.txt'), 'not yours');
    await drop('msg-4', { subject: 'Обход', attachments: ['../secret.txt'] });
    const [msg] = await adapter.poll();
    // The traversal is dropped, the letter still arrives: a crafted envelope must not be able
    // to turn an arbitrary file on the server into a document attachment.
    expect(msg?.attachments).toEqual([]);
  });

  it('skips an attachment over the size limit and keeps the letter', async () => {
    await mkdir(join(root, 'in'), { recursive: true });
    await writeFile(join(root, 'in', 'big.bin'), Buffer.alloc(MAX_BYTES + 1));
    await drop('msg-5', { subject: 'Большое вложение', attachments: ['big.bin'] });
    const [msg] = await adapter.poll();
    expect(msg?.attachments).toEqual([]);
  });

  it('reads an attachment that is within the limit', async () => {
    await mkdir(join(root, 'in'), { recursive: true });
    await writeFile(join(root, 'in', 'ok.pdf'), Buffer.from('%PDF-1.4'));
    await drop('msg-6', { subject: 'Обычное письмо', attachments: ['ok.pdf'] });
    const [msg] = await adapter.poll();
    expect(msg?.attachments).toHaveLength(1);
    expect(msg?.attachments[0]?.contentType).toBe('application/pdf');
    expect(msg?.attachments[0]?.body.toString('utf8')).toBe('%PDF-1.4');
  });
});

describe('FolderExchangeAdapter — acknowledge', () => {
  it('archives an accepted message instead of deleting it', async () => {
    await mkdir(join(root, 'in'), { recursive: true });
    await writeFile(join(root, 'in', 'msg-7.json'), JSON.stringify({ subject: 'Принято' }));
    await adapter.acknowledge('msg-7', 'accepted');
    expect(await readdir(join(root, 'in'))).toEqual([]);
    expect(await readdir(join(root, 'done'))).toContain('msg-7.json');
    // Still readable: an archived letter an operator cannot open is one nobody can check.
    const kept = await readFile(join(root, 'done', 'msg-7.json'), 'utf8');
    expect(kept).toContain('Принято');
  });

  it('keeps a rejected message apart, so a refusal can be investigated', async () => {
    await mkdir(join(root, 'in'), { recursive: true });
    await writeFile(join(root, 'in', 'msg-8.json'), JSON.stringify({ subject: 'Отклонено' }));
    await adapter.acknowledge('msg-8', 'rejected');
    expect(await readdir(join(root, 'rejected'))).toContain('msg-8.json');
  });

  it('does not throw when the message is already gone', async () => {
    await expect(adapter.acknowledge('never-existed', 'accepted')).resolves.toBeUndefined();
  });
});
