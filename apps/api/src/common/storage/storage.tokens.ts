/**
 * Injection token for the MinIO/S3 client, in its own file so the module and
 * service can both import it without a circular module<->service import.
 */
export const S3 = 'S3_CLIENT';

/**
 * A second client pointed at the browser-facing endpoint (S3_PUBLIC_ENDPOINT). Used ONLY to presign
 * upload/download/stream URLs so their host is one the browser can resolve; all real S3 operations run
 * through the internal {@link S3} client. Same client when S3_PUBLIC_ENDPOINT is unset (dev).
 */
export const S3_PUBLIC = 'S3_PUBLIC_CLIENT';
