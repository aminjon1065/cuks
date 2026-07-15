import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { PT_SANS_CYRILLIC_WOFF_BASE64 } from './pt-sans-font';

export interface StampSignature {
  signatureId: string;
  signerName: string;
  signerPosition: string | null;
  certificateSerial: string;
  signedAt: string;
  valid: boolean;
  verifyUrl: string;
}

export interface StampInput {
  documentSubject: string;
  documentRegNumber: string | null;
  signatures: StampSignature[];
  generatedAt: string;
}

const MARGIN = 48;
const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const OK = rgb(0.13, 0.55, 0.29);
const BAD = rgb(0.79, 0.16, 0.19);

/**
 * Build the "отметка об ЭЦП" PDF (docs/09-security.md §4): a standalone A4 artifact
 * listing each signature (who, position, when, certificate serial, validity) with a QR
 * code to its verification page. The original document file is never modified.
 */
export async function buildStampPdf(input: StampInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(Buffer.from(PT_SANS_CYRILLIC_WOFF_BASE64, 'base64'));

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const draw = (text: string, x: number, size: number, color = INK): void => {
    page.drawText(text, { x, y, size, font, color });
  };

  draw('Отметка об электронной подписи', MARGIN, 18);
  y -= 26;
  draw(clip(input.documentSubject, font, 12, PAGE.width - 2 * MARGIN), MARGIN, 12, MUTED);
  y -= 18;
  draw(`Рег. номер: ${input.documentRegNumber ?? 'без номера'}`, MARGIN, 11, MUTED);
  y -= 30;

  if (input.signatures.length === 0) {
    draw('Документ не содержит подписей.', MARGIN, 12, MUTED);
  }

  for (const sig of input.signatures) {
    y = await drawSignatureBlock(pdf, page, font, sig, y, () => {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      return page;
    });
  }

  // Footer: when this artifact was produced.
  page.drawText(`Сформировано: ${input.generatedAt}`, {
    x: MARGIN,
    y: MARGIN - 18,
    size: 9,
    font,
    color: MUTED,
  });

  return pdf.save();
}

async function drawSignatureBlock(
  pdf: PDFDocument,
  currentPage: PDFPage,
  font: PDFFont,
  sig: StampSignature,
  startY: number,
  addPage: () => PDFPage,
): Promise<number> {
  const blockHeight = 96;
  let page = currentPage;
  let y = startY;
  if (y - blockHeight < MARGIN + 24) {
    page = addPage();
    y = PAGE.height - MARGIN;
  }

  const qrPng = await QRCode.toBuffer(sig.verifyUrl, { margin: 0, width: 80 });
  const qr = await pdf.embedPng(qrPng);
  const qrSize = 72;
  page.drawImage(qr, {
    x: PAGE.width - MARGIN - qrSize,
    y: y - qrSize,
    width: qrSize,
    height: qrSize,
  });

  const line = (text: string, dy: number, size: number, color = INK): void => {
    page.drawText(text, { x: MARGIN, y: y - dy, size, font, color });
  };
  line(sig.signerName, 4, 13);
  line(sig.signerPosition ?? '—', 22, 10, MUTED);
  line(`Подписано: ${sig.signedAt}`, 40, 10, MUTED);
  line(`Сертификат: ${sig.certificateSerial}`, 56, 10, MUTED);
  line(
    sig.valid ? 'Подпись действительна' : 'Подпись недействительна',
    74,
    10,
    sig.valid ? OK : BAD,
  );

  page.drawLine({
    start: { x: MARGIN, y: y - blockHeight + 8 },
    end: { x: PAGE.width - MARGIN, y: y - blockHeight + 8 },
    thickness: 0.5,
    color: rgb(0.9, 0.91, 0.93),
  });
  return y - blockHeight;
}

/** Trim a string so its rendered width fits `maxWidth`, appending an ellipsis. */
function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}
