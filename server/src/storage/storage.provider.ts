export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  save(relPath: string, data: Buffer): Promise<void>;
  publicUrl(relPath: string): string;
  remove(relPath: string): Promise<void>;
}
