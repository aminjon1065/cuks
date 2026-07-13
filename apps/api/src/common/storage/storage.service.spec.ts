import { describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE_BYTES } from '@cuks/shared';
import { StorageService } from './storage.service';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://minio.local/presigned'),
}));

const fakeConfig = { get: () => 'test-bucket' } as never;

function notFoundError(): Error & { $metadata: { httpStatusCode: number } } {
  return Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } });
}

describe('StorageService.ensureBucket', () => {
  it('does nothing when the bucket already exists', async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = new StorageService({ send } as never, fakeConfig);
    await service.ensureBucket();
    expect(send).toHaveBeenCalledTimes(1); // HeadBucket only
  });

  it('creates the bucket when HeadBucket 404s', async () => {
    const send = vi.fn().mockRejectedValueOnce(notFoundError()).mockResolvedValueOnce({});
    const service = new StorageService({ send } as never, fakeConfig);
    await service.ensureBucket();
    expect(send).toHaveBeenCalledTimes(2); // HeadBucket, then CreateBucket
  });

  it('rethrows non-404 errors instead of masking them', async () => {
    const send = vi.fn().mockRejectedValue(new Error('access denied'));
    const service = new StorageService({ send } as never, fakeConfig);
    await expect(service.ensureBucket()).rejects.toThrow('access denied');
  });
});

describe('StorageService.initiateUpload', () => {
  it('rejects a declared size over the 2 GiB cap without calling S3', async () => {
    const send = vi.fn();
    const service = new StorageService({ send } as never, fakeConfig);
    await expect(
      service.initiateUpload('k', 'video/mp4', MAX_FILE_SIZE_BYTES + 1),
    ).rejects.toMatchObject({ code: 'files.upload.too_large' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns the upload id from S3 for an in-limit file', async () => {
    const send = vi.fn().mockResolvedValue({ UploadId: 'upload-1' });
    const service = new StorageService({ send } as never, fakeConfig);
    await expect(service.initiateUpload('k', 'video/mp4', 1024)).resolves.toEqual({
      uploadId: 'upload-1',
    });
  });
});

describe('StorageService.completeUpload', () => {
  it('completes the upload and returns eTag/size from the finished object', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({}) // CompleteMultipartUpload
      .mockResolvedValueOnce({ ETag: '"abc"', ContentLength: 42 }); // HeadObject
    const service = new StorageService({ send } as never, fakeConfig);
    const result = await service.completeUpload('k', 'u1', [
      { partNumber: 2, eTag: '"b"' },
      { partNumber: 1, eTag: '"a"' },
    ]);
    expect(result).toEqual({ eTag: '"abc"', size: 42 });
    const completeInput = send.mock.calls[0]![0].input;
    expect(
      completeInput.MultipartUpload.Parts.map((p: { PartNumber: number }) => p.PartNumber),
    ).toEqual([1, 2]);
  });
});

describe('StorageService.abortUpload', () => {
  it('sends an AbortMultipartUpload command', async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = new StorageService({ send } as never, fakeConfig);
    await service.abortUpload('k', 'u1');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('StorageService.deleteObject', () => {
  it('sends a DeleteObject command', async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = new StorageService({ send } as never, fakeConfig);
    await service.deleteObject('k');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('StorageService.getDownloadUrl', () => {
  it('sets a forced attachment Content-Disposition, encoding non-ASCII filenames', async () => {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const service = new StorageService({ send: vi.fn() } as never, fakeConfig);
    const url = await service.getDownloadUrl('k', 'Отчёт.pdf');
    expect(url).toBe('https://minio.local/presigned');
    const command = vi.mocked(getSignedUrl).mock.calls[0]![1] as {
      input: { ResponseContentDisposition: string };
    };
    expect(command.input.ResponseContentDisposition).toContain('attachment; filename="');
    expect(command.input.ResponseContentDisposition).toContain(
      `filename*=UTF-8''${encodeURIComponent('Отчёт.pdf')}`,
    );
  });
});
