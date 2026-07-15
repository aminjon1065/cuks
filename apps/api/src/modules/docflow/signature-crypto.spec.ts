import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSignPayload } from '@cuks/shared';
import {
  buildCertificateBody,
  caSign,
  caVerify,
  decryptPrivateKey,
  encryptPrivateKey,
  exportSpki,
  fromBase64,
  generateCaKeyPair,
  importUserPublicKey,
  sha256Hex,
  toBase64,
  userVerify,
  utf8,
  type CertificateBody,
} from './signature-crypto';

const { subtle } = webcrypto;

async function userKeyPair(): Promise<webcrypto.CryptoKeyPair> {
  return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}

describe('signature-crypto', () => {
  it('issues and verifies a device certificate against the CA (chain of trust)', async () => {
    const ca = await generateCaKeyPair();
    const user = await userKeyPair();
    const spki = toBase64(await exportSpki(user.publicKey));
    const body: CertificateBody = {
      serial: 'abc123',
      userId: '0190a000-0000-7000-8000-000000000001',
      kind: 'device',
      subject: { username: 'nazarova.n', fullName: 'Назарова Н.', position: 'Инспектор' },
      publicKeySpki: spki,
      notBefore: '2026-07-15T00:00:00.000Z',
      notAfter: '2028-07-15T00:00:00.000Z',
    };
    const caSignature = await caSign(ca.privateKey, utf8(buildCertificateBody(body)));

    expect(await caVerify(ca.publicKey, caSignature, utf8(buildCertificateBody(body)))).toBe(true);

    // Any tamper with the certified fields breaks the chain.
    const forged = { ...body, subject: { ...body.subject, fullName: 'Кто-то Другой' } };
    expect(await caVerify(ca.publicKey, caSignature, utf8(buildCertificateBody(forged)))).toBe(
      false,
    );

    // A different CA does not vouch for it.
    const otherCa = await generateCaKeyPair();
    expect(await caVerify(otherCa.publicKey, caSignature, utf8(buildCertificateBody(body)))).toBe(
      false,
    );
  });

  it('verifies a document signature and rejects a tampered payload', async () => {
    const user = await userKeyPair();
    const spki = toBase64(await exportSpki(user.publicKey));
    const payload = buildSignPayload({
      fileSha256: await sha256Hex(utf8('the file bytes')),
      regNumber: null,
      regDate: null,
      subject: 'Приказ',
    });
    const signature = new Uint8Array(
      await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, user.privateKey, utf8(payload)),
    );

    const pub = await importUserPublicKey(fromBase64(spki));
    expect(await userVerify(pub, signature, utf8(payload))).toBe(true);

    // A file swap (different bytes → different fileSha256) invalidates the signature.
    const tampered = buildSignPayload({
      fileSha256: await sha256Hex(utf8('DIFFERENT bytes')),
      regNumber: null,
      regDate: null,
      subject: 'Приказ',
    });
    expect(await userVerify(pub, signature, utf8(tampered))).toBe(false);
  });

  it('round-trips the CA private key through passphrase encryption', async () => {
    const secret = utf8('pretend-pkcs8-key-material');
    const enc = encryptPrivateKey(secret, 'correct horse battery staple');
    expect(decryptPrivateKey(enc, 'correct horse battery staple')).toEqual(secret);
    // A wrong passphrase fails the GCM auth tag rather than returning garbage.
    expect(() => decryptPrivateKey(enc, 'wrong passphrase')).toThrow();
  });

  it('rejects a public key that is not a valid P-256 SPKI', async () => {
    await expect(importUserPublicKey(fromBase64('bm90LWEta2V5'))).rejects.toBeDefined();
  });
});
