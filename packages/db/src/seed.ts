/**
 * Database seeds (admin user, roles, org skeleton, reference data).
 * Implemented in phase 0.3 (docs/07-data-model.md). Placeholder for now.
 */
async function seed(): Promise<void> {
  console.log('No seeds yet — implemented in phase 0.3.');
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
