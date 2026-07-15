import { webcrypto } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { CA_SUBJECT, ensureCaFile, loadCaKeys } from './ca-store';
import {
  buildCertificateBody,
  caSign,
  caVerify,
  toBase64,
  utf8,
  type CertificateBody,
} from './signature-crypto';

/**
 * The internal certificate authority (docs/09-security.md §4, task 3.5). Holds an ECDSA
 * P-384 root key, encrypted at rest in the `ca_data` volume (`CA_DATA_DIR`) with a
 * passphrase from `CA_PASSPHRASE`. It is initialised lazily on first use — generating a
 * self-signed root the first time (the install-time `init-ca` script does the same) — so
 * the platform still boots without signing configured. The CA signs device certificates
 * (chain of trust) and verifies them.
 */
@Injectable()
export class CaService {
  private readonly logger = new Logger(CaService.name);
  private ready: Promise<{
    privateKey: webcrypto.CryptoKey;
    publicKey: webcrypto.CryptoKey;
  }> | null = null;
  private publicKeySpkiB64 = '';

  constructor(private readonly config: ConfigService) {}

  /** Derived dev passphrase keeps signing working locally; production requires a real
   *  CA_PASSPHRASE (enforced by the env schema). */
  private passphrase(): string {
    return this.config.get('CA_PASSPHRASE') ?? `ca:${this.config.get('SESSION_SECRET')}`;
  }

  private ensureReady(): Promise<{
    privateKey: webcrypto.CryptoKey;
    publicKey: webcrypto.CryptoKey;
  }> {
    if (!this.ready) this.ready = this.loadOrCreate();
    return this.ready;
  }

  private async loadOrCreate(): Promise<{
    privateKey: webcrypto.CryptoKey;
    publicKey: webcrypto.CryptoKey;
  }> {
    const dir = this.config.get('CA_DATA_DIR');
    const { file, created } = await ensureCaFile(dir, this.passphrase(), new Date());
    if (created) this.logger.log(`initialised internal CA "${CA_SUBJECT}" at ${dir}`);
    this.publicKeySpkiB64 = file.publicKeySpki;
    return loadCaKeys(file, this.passphrase());
  }

  /** Issue a device certificate: the CA's signature over the canonical certificate body
   *  (base64). The caller persists this alongside the certified fields. */
  async issueCertificate(body: CertificateBody): Promise<string> {
    const { privateKey } = await this.ensureReady();
    const signature = await caSign(privateKey, utf8(buildCertificateBody(body)));
    return toBase64(signature);
  }

  /** Verify a certificate still chains to this CA (its body signature is the CA's). */
  async verifyCertificate(body: CertificateBody, caSignatureB64: string): Promise<boolean> {
    const { publicKey } = await this.ensureReady();
    try {
      return await caVerify(
        publicKey,
        new Uint8Array(Buffer.from(caSignatureB64, 'base64')),
        utf8(buildCertificateBody(body)),
      );
    } catch {
      return false;
    }
  }

  /** The CA public key (SPKI, base64) + subject, for the verification page. */
  async info(): Promise<{ subject: string; publicKeySpki: string }> {
    await this.ensureReady();
    return { subject: CA_SUBJECT, publicKeySpki: this.publicKeySpkiB64 };
  }
}
