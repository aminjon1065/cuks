/**
 * Minimal XLSX + ZIP writers, dependency-free (docs/02: nothing is added for what a
 * hundred lines of the format spec already give us). XLSX is an Open Packaging
 * Convention ZIP; entries are *stored*, not deflated, which Excel and LibreOffice
 * both accept.
 *
 * Written against `Uint8Array`, not `Buffer`: this package is also compiled into the
 * browser bundle, so it must stay free of Node types. The api (the synchronous
 * registry export) and the worker (the background geo exports, task 2.8) wrap the
 * result in a Buffer at their edge.
 */
interface ZipEntry {
  name: Uint8Array;
  body: Uint8Array;
  crc: number;
  offset: number;
}

/** UTF-8 bytes. Hand-rolled because this package targets the ES2023 lib alone —
 *  `TextEncoder` is a platform global (DOM/Node), and pulling either lib in here
 *  would let platform-specific code slip into the browser bundle. */
function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A little-endian writer over a fixed-size record. */
function record(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function localHeader(entry: ZipEntry): Uint8Array {
  const { bytes, view } = record(30 + entry.name.length);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true); // UTF-8 names
  view.setUint16(8, 0, true); // store (no compression)
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.body.length, true);
  view.setUint32(22, entry.body.length, true);
  view.setUint16(26, entry.name.length, true);
  bytes.set(entry.name, 30);
  return bytes;
}

function centralHeader(entry: ZipEntry): Uint8Array {
  const { bytes, view } = record(46 + entry.name.length);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.body.length, true);
  view.setUint32(24, entry.body.length, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(42, entry.offset, true);
  bytes.set(entry.name, 46);
  return bytes;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Store-only ZIP. Used by the XLSX writer below and by the shapefile export, which
 *  has to ship its sidecar files (.shp/.shx/.dbf/.prj) as one download. */
export function buildZip(files: Readonly<Record<string, Uint8Array | string>>): Uint8Array {
  const entries: ZipEntry[] = [];
  const locals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const body = typeof content === 'string' ? utf8(content) : content;
    const entry: ZipEntry = { name: utf8(name), body, crc: crc32(body), offset };
    const local = localHeader(entry);
    locals.push(local, body);
    offset += local.length + body.length;
    entries.push(entry);
  }
  const central = entries.map(centralHeader);
  const centralSize = central.reduce((size, chunk) => size + chunk.length, 0);
  const { bytes: end, view } = record(22);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return concat([...locals, ...central, end]);
}

// Characters outside XML 1.0's legal Char range — the C0 controls except tab/LF/CR. They have
// no valid character reference either, so a raw one anywhere in the sheet makes it non-well-formed
// and Excel/LibreOffice reject the whole workbook. Names come from user input (org units, people),
// so strip these before escaping — matching what openpyxl and friends do. The control chars in
// the class are exactly the target of this rule, so no-control-regex is intentionally disabled.
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function escapeXml(value: string): string {
  return value.replace(XML_ILLEGAL, '').replace(/[<>&"']/g, (char) => {
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '&') return '&amp;';
    if (char === '"') return '&quot;';
    return '&apos;';
  });
}

function columnName(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** A string cell. `t="inlineStr"` and `<is>` mean the text is literal data, never a
 *  formula — so an attribute value like `=1+2` from an export is shown, not
 *  evaluated (no CSV-injection analogue in the workbook). */
function inlineCell(ref: string, value: string): string {
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"><is><t${preserve}>${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

/** One row of cells; numbers are written as numbers, everything else as text. */
export type XlsxRow = readonly (string | number)[];

/** Build a one-sheet workbook. The first row is normally the header. */
export function buildXlsx(rows: readonly XlsxRow[], sheetName = 'Sheet1'): Uint8Array {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          return typeof value === 'number' ? numberCell(ref, value) : inlineCell(ref, value);
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return buildZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}
