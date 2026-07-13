import { Socket } from 'node:net';

export interface ClamdVerdict {
  infected: boolean;
  signature?: string;
}

const SCAN_TIMEOUT_MS = 60_000;
const CHUNK_SIZE = 1024 * 1024; // 1 MiB per INSTREAM frame

/**
 * Minimal clamd INSTREAM client — no dependency (the only maintained npm option,
 * `clamdjs`, hasn't been published since 2022, well past this project's >18-month
 * staleness bar — docs/02 §Политика зависимостей). The protocol itself is a small,
 * stable TCP framing (ClamAV's `clamdscan`/INSTREAM command, unchanged for years):
 * send `zINSTREAM\0`, then length-prefixed (4-byte big-endian) chunks, a
 * zero-length chunk signals EOF, then read one response line.
 */
export function scanBuffer(host: string, port: number, data: Buffer): Promise<ClamdVerdict> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let responseBuf = Buffer.alloc(0);
    let settled = false;

    const timer = setTimeout(() => {
      settle(() => reject(new Error('ClamAV scan timed out')));
    }, SCAN_TIMEOUT_MS);

    function settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    }

    socket.on('error', (err) => settle(() => reject(err)));

    socket.connect(port, host, () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const chunk = data.subarray(offset, offset + CHUNK_SIZE);
        const lenPrefix = Buffer.alloc(4);
        lenPrefix.writeUInt32BE(chunk.length, 0);
        socket.write(lenPrefix);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk = end of stream
    });

    socket.on('data', (buf) => {
      responseBuf = Buffer.concat([responseBuf, buf]);
    });
    socket.on('end', () => settle(() => resolve(parseResponse(responseBuf))));
    socket.on('close', () => settle(() => resolve(parseResponse(responseBuf))));
  });
}

export function parseResponse(buf: Buffer): ClamdVerdict {
  // e.g. "stream: OK" | "stream: Eicar-Test-Signature FOUND" | "stream: <msg> ERROR"
  const text = buf.toString('utf8').replace(/\0/g, '').trim();
  if (/\bFOUND\b/.test(text)) {
    const match = /stream:\s*(.+?)\s+FOUND/.exec(text);
    const signature = match?.[1]?.trim();
    return signature ? { infected: true, signature } : { infected: true };
  }
  if (/\bERROR\b/.test(text)) throw new Error(`ClamAV error: ${text}`);
  if (/\bOK\b/.test(text)) return { infected: false };
  throw new Error(`Unexpected ClamAV response: ${text || '(empty)'}`);
}
