/**
 * Device signing keys (docs/09-security.md §4, task 3.5). The private key is generated in
 * the browser with `extractable: false` and kept in IndexedDB — it never leaves the
 * device and the server never sees it. Only the public key (SPKI) is exported, to obtain
 * a CA certificate. Signing produces a raw (IEEE P1363) ECDSA-P256-SHA256 signature that
 * the server verifies with WebCrypto unchanged.
 */
const DB_NAME = 'cuks-eds';
const STORE = 'device-keys';
const KEY_ID = 'signing-key';
const CERT_ID = 'certificate-id';

interface StoredKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readStored<T>(key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}

async function writeStored(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Whether this device already has a signing key (so the sign flow can skip activation). */
export async function hasDeviceKey(): Promise<boolean> {
  return (await readStored<StoredKey>(KEY_ID)) !== null;
}

/** The device signing key, generating (non-extractable) and persisting it on first use. */
export async function getOrCreateDeviceKey(): Promise<StoredKey> {
  const existing = await readStored<StoredKey>(KEY_ID);
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])) as CryptoKeyPair;
  const stored: StoredKey = { privateKey: pair.privateKey, publicKey: pair.publicKey };
  await writeStored(KEY_ID, stored);
  return stored;
}

/** The certificate id issued for this device's key, if activation has happened here. */
export async function getStoredCertificateId(): Promise<string | null> {
  return readStored<string>(CERT_ID);
}

export async function setStoredCertificateId(id: string): Promise<void> {
  await writeStored(CERT_ID, id);
}

/** The device public key as base64 SPKI, for certificate activation. */
export async function exportPublicKeySpki(publicKey: CryptoKey): Promise<string> {
  return toBase64(await crypto.subtle.exportKey('spki', publicKey));
}

/** Sign the canonical payload with the device private key → base64 (raw ECDSA). */
export async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(payload),
  );
  return toBase64(sig);
}
