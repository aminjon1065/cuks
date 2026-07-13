/**
 * Injection token for the MinIO/S3 client, in its own file so the module and
 * service can both import it without a circular module<->service import.
 */
export const S3 = 'S3_CLIENT';
