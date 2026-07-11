import { Injectable } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageProvider } from './storage.provider';

@Injectable()
export class LocalDiskStorage implements StorageProvider {
  constructor(
    private readonly rootDir: string = process.env.MEDIA_DIR ??
      path.join(process.cwd(), 'media'),
    private readonly baseUrl: string = process.env.PUBLIC_MEDIA_BASE ??
      'http://localhost:3001/media',
  ) {}

  private resolveSafe(relPath: string): string {
    const full = path.resolve(this.rootDir, relPath);
    if (!full.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`Unsafe media path: ${relPath}`);
    }
    return full;
  }

  async save(relPath: string, data: Buffer): Promise<void> {
    const full = this.resolveSafe(relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  publicUrl(relPath: string): string {
    return `${this.baseUrl}/${relPath.replaceAll('\\', '/')}`;
  }

  async remove(relPath: string): Promise<void> {
    await rm(this.resolveSafe(relPath), { force: true });
  }
}
