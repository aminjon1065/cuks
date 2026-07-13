/**
 * Real-bytes checks for text-based dangerous content that has no binary magic-
 * byte signature `file-type` (mime-sniff.ts) can key off — SVG-embedded scripts
 * and shell/batch scripts. Keyed on the actual bytes, never the client-declared
 * MIME type (docs/09 §2: "не доверять расширению") — a file lying about its
 * Content-Type gets no free pass.
 */

const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16BE = Buffer.from([0xfe, 0xff]);
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);

// Cheap prefix check to decide "is this worth a full scan" — enough to see past
// a BOM/XML declaration/doctype/whitespace to an opening <svg tag.
const SVG_SNIFF_PREFIX_BYTES = 4_096;
// SVGs are text; real-world ones are rarely more than a few hundred KB. Bounded
// well above that so padding a payload past a small cutoff (the original
// SVG_SCAN_BYTES=64KiB gap) doesn't hide a trailing <script> tag, without
// decoding an arbitrarily large buffer for something that merely starts like SVG.
const SVG_FULL_SCAN_BYTES = 4 * 1024 * 1024;

function decodeText(bytes: Buffer, limit: number): string {
  const window = bytes.subarray(0, Math.min(bytes.length, limit));
  if (window.subarray(0, 2).equals(BOM_UTF16LE)) {
    return window.subarray(2).toString('utf16le');
  }
  if (window.subarray(0, 2).equals(BOM_UTF16BE)) {
    // Node has no native UTF-16BE decoder — byte-swap into LE first.
    const swapped = Buffer.from(window.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const hi = swapped[i]!;
      swapped[i] = swapped[i + 1]!;
      swapped[i + 1] = hi;
    }
    return swapped.toString('utf16le');
  }
  const start = window.subarray(0, 3).equals(BOM_UTF8) ? 3 : 0;
  return window.toString('utf8', start);
}

const SVG_ROOT_PATTERN = /<svg[\s>]/i;
// Covers the common SVG-XSS surface: <script>, any on*="" event handler
// attribute, and javascript:/xlink:href javascript: URIs — not just a literal
// "<script" substring.
const SVG_DANGEROUS_PATTERN =
  /<script[\s>]|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["']?\s*javascript:/i;

/** True if the real bytes decode (UTF-8, UTF-16LE/BE with BOM) to something
 *  containing an embedded script/event-handler/javascript: URI, regardless of
 *  the client-declared MIME type. */
export function hasDangerousSvgContent(bytes: Buffer): boolean {
  const prefix = decodeText(bytes, SVG_SNIFF_PREFIX_BYTES);
  if (!SVG_ROOT_PATTERN.test(prefix)) return false;
  const full = decodeText(bytes, SVG_FULL_SCAN_BYTES);
  return SVG_DANGEROUS_PATTERN.test(full);
}

/** Shell/batch/perl/etc scripts are plain text with no magic-byte signature —
 *  a `#!` shebang is the one reliable real-bytes marker for "this is an
 *  executable script", regardless of declared MIME/extension. */
export function isShebangScript(bytes: Buffer): boolean {
  return bytes.subarray(0, 2).toString('latin1') === '#!';
}
