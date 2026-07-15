import { describe, expect, it } from 'vitest';
import { buildStampPdf } from './pdf-stamp';

describe('buildStampPdf', () => {
  it('produces a valid PDF with Cyrillic signer names and a QR per signature', async () => {
    const bytes = await buildStampPdf({
      documentSubject: 'О мерах по предупреждению ЧС',
      documentRegNumber: 'П-2026/0007',
      generatedAt: '2026-07-15T10:00:00.000Z',
      signatures: [
        {
          signatureId: '0190a000-0000-7000-8000-000000000001',
          signerName: 'Назаров Н.Н.',
          signerPosition: 'Начальник управления',
          certificateSerial: 'abc123def456',
          signedAt: '2026-07-15T09:00:00.000Z',
          valid: true,
          verifyUrl: 'https://cuks.local/app/verify/0190a000-0000-7000-8000-000000000001',
        },
      ],
    });
    // Starts with the PDF magic and is a non-trivial document.
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('renders a signatures-less document without throwing', async () => {
    const bytes = await buildStampPdf({
      documentSubject: 'Пустой документ',
      documentRegNumber: null,
      generatedAt: '2026-07-15T10:00:00.000Z',
      signatures: [],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});
