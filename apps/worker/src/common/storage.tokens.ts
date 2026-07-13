/** Injection token for the worker's own MinIO/S3 client — no cross-app import from
 *  apps/api (docs/plan/STATUS.md 1.1 decision: each app owns its infra clients).
 *  Kept in its own file (mirrors apps/api/src/common/storage/storage.tokens.ts) so
 *  storage.module.ts and storage.service.ts don't import each other directly —
 *  that circular import left `@Inject(S3)` decorated with `undefined` at runtime. */
export const S3 = 'S3_CLIENT';
