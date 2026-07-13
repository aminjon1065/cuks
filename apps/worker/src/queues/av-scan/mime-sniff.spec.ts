import { describe, expect, it } from 'vitest';
import { sniffMime } from './mime-sniff';

describe('sniffMime', () => {
  it('detects a Windows executable from its magic bytes (MZ header)', async () => {
    const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    await expect(sniffMime(exeHeader)).resolves.toBe('application/x-msdownload');
  });

  it('returns undefined for content with no recognizable signature', async () => {
    await expect(
      sniffMime(Buffer.from('just plain text, not a real file')),
    ).resolves.toBeUndefined();
  });
});
