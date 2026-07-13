import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseResponse, scanBuffer } from './clamd-client';

describe('parseResponse', () => {
  it('parses a clean verdict', () => {
    expect(parseResponse(Buffer.from('stream: OK\0'))).toEqual({ infected: false });
  });

  it('parses an infected verdict with signature', () => {
    expect(parseResponse(Buffer.from('stream: Eicar-Test-Signature FOUND\0'))).toEqual({
      infected: true,
      signature: 'Eicar-Test-Signature',
    });
  });

  it('throws on an ERROR response', () => {
    expect(() => parseResponse(Buffer.from('stream: Size limit exceeded. ERROR\0'))).toThrow(
      /ClamAV error/,
    );
  });

  it('throws on an unrecognized response', () => {
    expect(() => parseResponse(Buffer.from('garbage\0'))).toThrow(/Unexpected ClamAV response/);
  });
});

describe('scanBuffer (real TCP round trip against a fake clamd)', () => {
  let server: Server;
  let port: number;

  afterEach(() => {
    server?.close();
  });

  function startFakeClamd(reply: string): Promise<number> {
    return new Promise((resolve) => {
      server = createServer((socket) => {
        const chunks: Buffer[] = [];
        socket.on('data', (chunk) => {
          chunks.push(chunk);
          // A zero-length 4-byte frame signals end of stream — reply once we see it.
          const all = Buffer.concat(chunks);
          if (all.length >= 4 && all.subarray(-4).equals(Buffer.alloc(4))) {
            socket.end(reply);
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
  }

  it('sends a correctly-framed INSTREAM request and parses a clean reply', async () => {
    port = await startFakeClamd('stream: OK\0');
    const verdict = await scanBuffer('127.0.0.1', port, Buffer.from('hello world'));
    expect(verdict).toEqual({ infected: false });
  });

  it('parses an infected reply from the real socket path', async () => {
    port = await startFakeClamd('stream: Eicar-Test-Signature FOUND\0');
    const verdict = await scanBuffer('127.0.0.1', port, Buffer.from('X5O!P%@AP'));
    expect(verdict).toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
  });

  it('frames a multi-chunk payload correctly (data larger than one 1 MiB frame)', async () => {
    port = await startFakeClamd('stream: OK\0');
    const big = Buffer.alloc(1024 * 1024 + 500, 'a'); // spans two INSTREAM chunks
    const verdict = await scanBuffer('127.0.0.1', port, big);
    expect(verdict).toEqual({ infected: false });
  });
});
