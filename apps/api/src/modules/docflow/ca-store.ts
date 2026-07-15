import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  decryptPrivateKey,
  encryptPrivateKey,
  exportPkcs8,
  exportSpki,
  generateCaKeyPair,
  importCaPrivateKey,
  importCaPublicKey,
  toBase64,
  type EncryptedKey,
} from './signature-crypto';

export const CA_SUBJECT = 'CUKS Root CA';
const CA_FILE = 'ca.json';

export interface CaFile {
  version: 1;
  subject: string;
  createdAt: string;
  publicKeySpki: string;
  privateKey: EncryptedKey;
}

/** Read the CA material from `dir`, or null if it has not been initialised. */
export async function readCaFile(dir: string): Promise<CaFile | null> {
  const raw = await readFile(join(dir, CA_FILE), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  return raw ? (JSON.parse(raw) as CaFile) : null;
}

/** Generate a fresh self-signed root (ECDSA P-384), encrypting the private key at rest. */
export async function generateCaFile(passphrase: string, now: Date): Promise<CaFile> {
  const pair = await generateCaKeyPair();
  const [pkcs8, spki] = await Promise.all([
    exportPkcs8(pair.privateKey),
    exportSpki(pair.publicKey),
  ]);
  return {
    version: 1,
    subject: CA_SUBJECT,
    createdAt: now.toISOString(),
    publicKeySpki: toBase64(spki),
    privateKey: encryptPrivateKey(pkcs8, passphrase),
  };
}

/** Persist CA material to `dir/ca.json` with owner-only permissions. */
export async function writeCaFile(dir: string, file: CaFile): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, CA_FILE), JSON.stringify(file, null, 2), { mode: 0o600 });
}

/** Read the CA if present, otherwise generate + persist it. Returns the file and whether
 *  it was freshly created. */
export async function ensureCaFile(
  dir: string,
  passphrase: string,
  now: Date,
): Promise<{ file: CaFile; created: boolean }> {
  const existing = await readCaFile(dir);
  if (existing) return { file: existing, created: false };
  const file = await generateCaFile(passphrase, now);
  await writeCaFile(dir, file);
  return { file, created: true };
}

/** Import the CA key pair from stored material, decrypting the private key. */
export async function loadCaKeys(
  file: CaFile,
  passphrase: string,
): Promise<{ privateKey: webcrypto.CryptoKey; publicKey: webcrypto.CryptoKey }> {
  const pkcs8 = decryptPrivateKey(file.privateKey, passphrase);
  const [privateKey, publicKey] = await Promise.all([
    importCaPrivateKey(pkcs8),
    importCaPublicKey(new Uint8Array(Buffer.from(file.publicKeySpki, 'base64'))),
  ]);
  return { privateKey, publicKey };
}
