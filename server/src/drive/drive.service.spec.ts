import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DriveService } from './drive.service';

function mockDrive() {
  return {
    files: {
      get: jest.fn(),
      update: jest.fn(),
    },
  };
}

function serviceWith(drive: ReturnType<typeof mockDrive>): DriveService {
  return new DriveService(() => drive as never);
}

function errorWithStatus(
  status: number,
): Error & { response: { status: number } } {
  return Object.assign(new Error(`drive api error ${status}`), {
    response: { status },
  });
}

function errorWithCode(code: number): Error & { code: number } {
  return Object.assign(new Error(`drive api error ${code}`), { code });
}

describe('DriveService', () => {
  it('(a) getFileMeta maps id/name/mimeType/copyRequiresWriterPermission from the Drive response', async () => {
    const drive = mockDrive();
    drive.files.get.mockResolvedValue({
      data: {
        id: 'f1',
        name: 'Chapter 1.pdf',
        mimeType: 'application/pdf',
        copyRequiresWriterPermission: true,
      },
    });
    const service = serviceWith(drive);

    const meta = await service.getFileMeta('f1');

    expect(meta).toEqual({
      id: 'f1',
      name: 'Chapter 1.pdf',
      mimeType: 'application/pdf',
      copyRequiresWriterPermission: true,
    });
    expect(drive.files.get).toHaveBeenCalledWith({
      fileId: 'f1',
      fields: 'id,name,mimeType,copyRequiresWriterPermission',
      supportsAllDrives: true,
    });
  });

  it('(a2) getFileMeta defaults copyRequiresWriterPermission to false when the API omits it', async () => {
    const drive = mockDrive();
    drive.files.get.mockResolvedValue({
      data: { id: 'f1', name: 'Chapter 1.pdf', mimeType: 'application/pdf' },
    });
    const service = serviceWith(drive);

    const meta = await service.getFileMeta('f1');

    expect(meta.copyRequiresWriterPermission).toBe(false);
  });

  it('(b) maps a 404 from the API to NotFoundException with the file id in the message', async () => {
    const drive = mockDrive();
    drive.files.get.mockRejectedValue(errorWithStatus(404));
    const service = serviceWith(drive);

    const result = service.getFileMeta('missing-file');

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('missing-file');
  });

  it('(c) maps a 403 from the API to ForbiddenException', async () => {
    const drive = mockDrive();
    drive.files.get.mockRejectedValue(errorWithCode(403));
    const service = serviceWith(drive);

    const result = service.getFileMeta('secret-file');

    await expect(result).rejects.toThrow(ForbiddenException);
    await expect(result).rejects.toThrow('secret-file');
  });

  it('(d) downloadFile returns a Buffer built from an arraybuffer response', async () => {
    const drive = mockDrive();
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    drive.files.get.mockResolvedValue({ data: bytes.buffer });
    const service = serviceWith(drive);

    const result = await service.downloadFile('f1');

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(drive.files.get).toHaveBeenCalledWith(
      { fileId: 'f1', alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
  });

  it('(e) setCopyProtection calls files.update with copyRequiresWriterPermission and supportsAllDrives', async () => {
    const drive = mockDrive();
    drive.files.update.mockResolvedValue({});
    const service = serviceWith(drive);

    await service.setCopyProtection('f1');

    expect(drive.files.update).toHaveBeenCalledWith({
      fileId: 'f1',
      requestBody: { copyRequiresWriterPermission: true },
      supportsAllDrives: true,
    });
  });

  it('(f) re-throws unknown errors untouched', async () => {
    const drive = mockDrive();
    const boom = new Error('quota exceeded');
    drive.files.get.mockRejectedValue(boom);
    const service = serviceWith(drive);

    const result = service.downloadFile('f1');

    await expect(result).rejects.toBe(boom);
  });
});
