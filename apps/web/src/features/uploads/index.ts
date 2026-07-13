/**
 * Reusable upload building blocks (task 1.7). Presentational primitives
 * (FileDropzone, AttachmentList) live in `@cuks/ui`; this feature layer holds the
 * wiring that depends on the API client / react-query / i18n and can't sit in the
 * design system.
 */
export { uploadFile, isUploadAbort } from './api/upload-file';
export type { UploadStatus, UploadTarget, UploadHandlers } from './api/upload-file';
export { useUploadStore } from './api/upload-store';
export type { UploadItem } from './api/upload-store';
export { useUploadManager } from './hooks/use-upload-manager';
export type { ManagedUpload, UploadManager } from './hooks/use-upload-manager';
export { UploadDock } from './components/UploadDock';
export { AttachmentField } from './components/AttachmentField';
export type { AttachmentFieldProps } from './components/AttachmentField';
