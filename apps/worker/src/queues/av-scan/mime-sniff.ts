/**
 * `file-type` ships ESM-only (no CJS build), which this app's `moduleResolution`
 * can't resolve types for even through a dynamic import — isolated here behind a
 * minimal local interface instead of widening `moduleResolution` project-wide.
 */
interface FileTypeModule {
  fileTypeFromBuffer(buffer: Buffer): Promise<{ mime: string; ext: string } | undefined>;
}

// A non-literal specifier stops TS from statically resolving (and failing on)
// file-type's own types for this dynamic import.
const FILE_TYPE_MODULE = 'file-type';

export async function sniffMime(buffer: Buffer): Promise<string | undefined> {
  const mod = (await import(FILE_TYPE_MODULE)) as unknown as FileTypeModule;
  const result = await mod.fileTypeFromBuffer(buffer);
  return result?.mime;
}
