import { createCipheriv, createDecipheriv, randomBytes, scryptSync, webcrypto } from 'node:crypto';

/**
 * Signature primitives for the internal ЭЦП (docs/09-security.md §4, task 3.5). Uses
 * only WebCrypto (`node:crypto`.webcrypto) + node:crypto — no third-party crypto and no
 * custom primitives (CLAUDE.md §6). The CA is ECDSA P-384/SHA-384; user (device) keys
 * are ECDSA P-256/SHA-256. Signatures are raw (IEEE P1363) so a browser-produced
 * signature verifies unchanged on the server (both sides speak WebCrypto).
 */
const { subtle } = webcrypto;

export const CA_CURVE = 'P-384';
export const CA_HASH = 'SHA-384';
export const USER_CURVE = 'P-256';
export const USER_HASH = 'SHA-256';

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await subtle.digest('SHA-256', bytes);
  return Buffer.from(new Uint8Array(digest)).toString('hex');
}

// --- Key generation / import / export --------------------------------------

export async function generateCaKeyPair(): Promise<webcrypto.CryptoKeyPair> {
  return subtle.generateKey({ name: 'ECDSA', namedCurve: CA_CURVE }, true, ['sign', 'verify']);
}

export async function exportPkcs8(key: webcrypto.CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey('pkcs8', key));
}

export async function exportSpki(key: webcrypto.CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey('spki', key));
}

export async function importCaPrivateKey(pkcs8: Uint8Array): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: CA_CURVE }, false, ['sign']);
}

export async function importCaPublicKey(spki: Uint8Array): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: CA_CURVE }, false, ['verify']);
}

/** Import a device's public key from the SPKI the browser exported. Throws if the bytes
 *  are not a valid P-256 SPKI key — used to reject a malformed activation request. */
export async function importUserPublicKey(spki: Uint8Array): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: USER_CURVE }, false, [
    'verify',
  ]);
}

// --- Sign / verify ---------------------------------------------------------

export async function caSign(
  caPrivate: webcrypto.CryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: CA_HASH }, caPrivate, message));
}

export async function caVerify(
  caPublic: webcrypto.CryptoKey,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  return subtle.verify({ name: 'ECDSA', hash: CA_HASH }, caPublic, signature, message);
}

export async function userVerify(
  userPublic: webcrypto.CryptoKey,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  return subtle.verify({ name: 'ECDSA', hash: USER_HASH }, userPublic, signature, message);
}

// --- CA private key at rest (AES-256-GCM, key from scrypt(passphrase)) ------

export interface EncryptedKey {
  salt: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export function encryptPrivateKey(pkcs8: Uint8Array, passphrase: string): EncryptedKey {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(pkcs8)), cipher.final()]);
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptPrivateKey(enc: EncryptedKey, passphrase: string): Uint8Array {
  const salt = Buffer.from(enc.salt, 'base64');
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return new Uint8Array(plaintext);
}

export function randomSerial(): string {
  return randomBytes(16).toString('hex');
}

// --- Canonical certificate body --------------------------------------------

export interface CertificateBody {
  serial: string;
  userId: string;
  kind: string;
  subject: { username: string; fullName: string; position: string | null };
  publicKeySpki: string;
  notBefore: string;
  notAfter: string;
}

/**
 * The exact bytes the CA signs to certify a device key. Deterministic field order —
 * issuing and verifying MUST build it identically or the chain check fails.
 */
export function buildCertificateBody(body: CertificateBody): string {
  return JSON.stringify({
    v: 1,
    issuer: 'CUKS Root CA',
    serial: body.serial,
    userId: body.userId,
    kind: body.kind,
    username: body.subject.username,
    fullName: body.subject.fullName,
    position: body.subject.position ?? null,
    publicKeySpki: body.publicKeySpki,
    notBefore: body.notBefore,
    notAfter: body.notAfter,
  });
}
