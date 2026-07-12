import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';

function saKey(): string {
  const b64 = process.env.GOOGLE_SA_PRIVATE_KEY_B64;
  if (!b64) throw new Error('GOOGLE_SA_PRIVATE_KEY_B64 is not set');
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function buildDriveClient(): drive_v3.Drive {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SA_CLIENT_EMAIL,
    key: saKey(),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

type DriveError = { code?: number; response?: { status?: number } };

function statusOf(e: unknown): number | undefined {
  const err = e as DriveError;
  return err.response?.status ?? err.code;
}

@Injectable()
export class DriveService {
  // Lazily built so the app boots without SA credentials (calls fail, boot doesn't).
  private client?: drive_v3.Drive;

  constructor(
    private readonly factory: () => drive_v3.Drive = buildDriveClient,
  ) {}

  private drive(): drive_v3.Drive {
    if (!this.client) this.client = this.factory();
    return this.client;
  }

  private mapError(e: unknown, fileId: string): never {
    const status = statusOf(e);
    if (status === 404)
      throw new NotFoundException(
        `Drive file ${fileId} not found or not shared with the platform service account`,
      );
    if (status === 403)
      throw new ForbiddenException(
        `Platform service account lacks access to Drive file ${fileId}`,
      );
    // Google returns 400 for operations that don't apply to the target —
    // e.g. PATCHing copyRequiresWriterPermission on a FOLDER id. Surface it
    // as a client error instead of letting it bubble into a generic 500.
    if (status === 400)
      throw new BadRequestException(
        `Drive rejected the operation on file ${fileId} (invalid operation for this file type)`,
      );
    throw e as Error;
  }

  async getFileMeta(fileId: string): Promise<{
    id: string;
    name: string;
    mimeType: string;
    copyRequiresWriterPermission: boolean;
  }> {
    try {
      const res = await this.drive().files.get({
        fileId,
        fields: 'id,name,mimeType,copyRequiresWriterPermission',
        supportsAllDrives: true,
      });
      return {
        id: res.data.id ?? fileId,
        name: res.data.name ?? '',
        mimeType: res.data.mimeType ?? '',
        copyRequiresWriterPermission:
          res.data.copyRequiresWriterPermission ?? false,
      };
    } catch (e) {
      this.mapError(e, fileId);
    }
  }

  async verifyAccess(fileId: string): Promise<{ ok: true; name: string }> {
    const meta = await this.getFileMeta(fileId);
    return { ok: true, name: meta.name };
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    try {
      const res = await this.drive().files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (e) {
      this.mapError(e, fileId);
    }
  }

  /**
   * Sets `copyRequiresWriterPermission` ("Viewers can't download") on a file.
   *
   * KNOWN LIMITATION: on consumer (non-Workspace) Drive, this flag is
   * OWNER-only — the platform service account (an Editor at best on
   * client-owned files) gets a 403 here even when it can read and download
   * the file fine. Callers must treat the resulting ForbiddenException as
   * "owner action required", not as missing access (see
   * AdminProductsController.verifyDrive's soft-fail handling).
   */
  async setCopyProtection(fileId: string): Promise<void> {
    try {
      await this.drive().files.update({
        fileId,
        requestBody: { copyRequiresWriterPermission: true },
        supportsAllDrives: true,
      });
    } catch (e) {
      this.mapError(e, fileId);
    }
  }
}
