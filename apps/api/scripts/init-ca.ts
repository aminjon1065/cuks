/**
 * Initialise the internal signing CA (docs/09-security.md §4, task 3.5). Generates the
 * ECDSA P-384 root key (encrypted at rest) into CA_DATA_DIR if it is not there yet, and
 * is a no-op if it already exists. Run at install time:
 *
 *   CA_PASSPHRASE=... CA_DATA_DIR=/data/ca pnpm --filter @cuks/api init-ca
 *
 * The API also initialises the CA lazily on first signing, so this script is a
 * convenience for provisioning the `ca_data` volume ahead of time.
 */
import '../src/config/load-env';
import { ensureCaFile } from '../src/modules/docflow/ca-store';

async function main(): Promise<void> {
  const dir = process.env.CA_DATA_DIR ?? '.ca';
  const passphrase =
    process.env.CA_PASSPHRASE ??
    (process.env.SESSION_SECRET ? `ca:${process.env.SESSION_SECRET}` : undefined);
  if (!passphrase) {
    console.error('Set CA_PASSPHRASE (or SESSION_SECRET for dev) before initialising the CA.');
    process.exitCode = 1;
    return;
  }
  const { file, created } = await ensureCaFile(dir, passphrase, new Date());
  console.log(
    created
      ? `Initialised CA "${file.subject}" in ${dir} (created ${file.createdAt}).`
      : `CA already present in ${dir} ("${file.subject}", created ${file.createdAt}).`,
  );
}

void main();
