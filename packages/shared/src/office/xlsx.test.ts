import { describe, expect, it } from 'vitest';
import { buildXlsx } from './xlsx';

/** Decode the (store-only, uncompressed) workbook bytes to a binary string so the inlined
 *  worksheet XML can be inspected directly. */
function asText(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return text;
}

const VTAB = String.fromCharCode(0x0b); // vertical tab — illegal in XML 1.0

describe('buildXlsx', () => {
  it('escapes XML metacharacters in text cells', () => {
    const text = asText(buildXlsx([['a < b & c > d "q" \'p\'']]));
    expect(text).toContain('a &lt; b &amp; c &gt; d &quot;q&quot; &apos;p&apos;');
  });

  it('strips XML-illegal control characters so the workbook stays well-formed', () => {
    // A raw 0x0B has no valid escape and would make the sheet non-well-formed, so Excel would
    // reject the whole file — the writer must strip it.
    // ASCII so the byte-per-char decode matches the source string 1:1.
    const text = asText(buildXlsx([[`Unit${VTAB}A<`]]));
    // The exact raw sequence must not survive into the sheet (a lone 0x0B can appear in ZIP
    // metadata bytes, so assert on the name, not the whole archive).
    expect(text).not.toContain(`Unit${VTAB}A`);
    expect(text).toContain('UnitA&lt;'); // control char gone, metachar still escaped
  });

  it('keeps tab, newline and carriage return, which are legal in XML 1.0', () => {
    const text = asText(buildXlsx([['a\tb\nc\rd']]));
    expect(text).toContain('a\tb\nc\rd');
  });

  it('writes numbers as numeric cells and strings as inline strings', () => {
    const text = asText(buildXlsx([['Итого', 42]]));
    expect(text).toContain('<v>42</v>'); // numeric cell, no inline-string wrapper
    expect(text).toContain('t="inlineStr"'); // the label is an inline string
  });
});
