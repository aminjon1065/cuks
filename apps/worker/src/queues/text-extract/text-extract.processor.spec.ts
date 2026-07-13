import { describe, expect, it, vi } from 'vitest';
import { MAX_EXTRACTED_TEXT_LENGTH } from '@cuks/shared';
import { TextExtractProcessor } from './text-extract.processor';

const getTextMock = vi.fn();
const destroyMock = vi.fn().mockResolvedValue(undefined);
vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({ getText: getTextMock, destroy: destroyMock })),
}));

const extractRawTextMock = vi.fn();
vi.mock('mammoth', () => ({
  default: { extractRawText: (...args: unknown[]) => extractRawTextMock(...args) },
}));

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return obj;
}

function makeProcessor(bytes = Buffer.from('doc-bytes'), avStatus: string | undefined = 'clean') {
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const db = {
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn(() => selectChain(avStatus === undefined ? [] : [{ avStatus }])),
  };
  const storage = { getObject: vi.fn().mockResolvedValue(bytes) };
  const processor = new TextExtractProcessor(db as never, storage as never);
  return { processor, updateSet, storage };
}

describe('TextExtractProcessor', () => {
  it('extracts and stores PDF text via pdf-parse', async () => {
    getTextMock.mockResolvedValue({ text: 'Extracted PDF content' });
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' },
    } as never);
    expect(updateSet).toHaveBeenCalledWith({ extractedText: 'Extracted PDF content' });
    expect(destroyMock).toHaveBeenCalled();
  });

  it('extracts and stores DOCX text via mammoth', async () => {
    extractRawTextMock.mockResolvedValue({ value: 'Extracted DOCX content' });
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: {
        nodeId: 'n1',
        versionId: 'v1',
        storageKey: 'k1',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    } as never);
    expect(updateSet).toHaveBeenCalledWith({ extractedText: 'Extracted DOCX content' });
  });

  it('truncates extracted text to the configured cap', async () => {
    getTextMock.mockResolvedValue({ text: 'x'.repeat(MAX_EXTRACTED_TEXT_LENGTH + 5000) });
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' },
    } as never);
    const setArg = updateSet.mock.calls[0]![0] as { extractedText: string };
    expect(setArg.extractedText.length).toBe(MAX_EXTRACTED_TEXT_LENGTH);
  });

  it('does not split a surrogate pair straddling the truncation boundary', async () => {
    // An astral-plane character (built from its two surrogate code units via
    // fromCharCode, not a literal escape) placed exactly at the cut point.
    const emoji = String.fromCharCode(0xd83d, 0xde00);
    const text = 'a'.repeat(MAX_EXTRACTED_TEXT_LENGTH - 1) + emoji;
    getTextMock.mockResolvedValue({ text });
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' },
    } as never);
    const setArg = updateSet.mock.calls[0]![0] as { extractedText: string };
    // Trimmed one code unit short rather than keeping a lone high surrogate.
    expect(setArg.extractedText.length).toBe(MAX_EXTRACTED_TEXT_LENGTH - 1);
    expect(setArg.extractedText).toBe('a'.repeat(MAX_EXTRACTED_TEXT_LENGTH - 1));
  });

  it('strips embedded NUL and other C0 control characters before storing', async () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    getTextMock.mockResolvedValue({ text: 'before' + nul + bell + 'afterend' });
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' },
    } as never);
    expect(updateSet).toHaveBeenCalledWith({ extractedText: 'beforeafterend' });
  });

  it('keeps tab/newline/CR when stripping control characters', async () => {
    const tab = String.fromCharCode(9);
    const lf = String.fromCharCode(10);
    const cr = String.fromCharCode(13);
    getTextMock.mockResolvedValue({ text: 'line1' + lf + 'line2' + tab + 'tab' + cr + 'cr' });
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' },
    } as never);
    expect(updateSet).toHaveBeenCalledWith({
      extractedText: 'line1' + lf + 'line2' + tab + 'tab' + cr + 'cr',
    });
  });

  it('skips unsupported mime types without erroring', async () => {
    const { processor, updateSet } = makeProcessor();
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/zip' },
    } as never);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('skips a version that is not (or no longer) clean-verdict, without touching storage', async () => {
    const { processor, updateSet, storage } = makeProcessor(undefined, 'pending');
    await processor.process({
      data: { nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' },
    } as never);
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });
});
