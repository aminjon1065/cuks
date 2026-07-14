/**
 * Minimal XLSX writer for the small synchronous registry export. XLSX is an Open
 * Packaging Convention ZIP; storing XML entries (rather than compressing them)
 * keeps the implementation dependency-free and works in Excel/LibreOffice while
 * the large background geo exports remain a later worker task (2.8).
 */
interface ZipEntry {
  name: string;
  body: Buffer;
  crc: number;
  offset: number;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(0, 8); // store (no compression)
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.body.length, 18);
  header.writeUInt32LE(entry.body.length, 22);
  header.writeUInt16LE(name.length, 26);
  name.copy(header, 30);
  return header;
}

function centralHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.body.length, 20);
  header.writeUInt32LE(entry.body.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(entry.offset, 42);
  name.copy(header, 46);
  return header;
}

function zip(files: Readonly<Record<string, string>>): Buffer {
  const entries: ZipEntry[] = [];
  let offset = 0;
  const locals: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const entry: ZipEntry = { name, body, crc: crc32(body), offset };
    const local = localHeader(entry);
    locals.push(local, body);
    offset += local.length + body.length;
    entries.push(entry);
  }
  const central = entries.map(centralHeader);
  const centralSize = central.reduce((size, chunk) => size + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
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

function inlineCell(ref: string, value: string): string {
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"><is><t${preserve}>${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

export type IncidentExportRow = readonly (string | number)[];

export function buildIncidentXlsx(rows: readonly IncidentExportRow[]): Buffer {
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
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Реестр ЧС" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}
