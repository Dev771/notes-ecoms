import * as fs from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalDiskStorage } from './local-disk.storage';

describe('LocalDiskStorage', () => {
  let storage: LocalDiskStorage;
  // Test-owned parent of the media root: a `../` traversal from the root
  // would land here, so tests can assert it stays clean — deterministically,
  // unlike the shared os.tmpdir().
  let parentDir: string;
  let tempDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
    tempDir = path.join(parentDir, 'media');
    fs.mkdirSync(tempDir);
    storage = new LocalDiskStorage(tempDir, 'http://localhost:3001/media');
  });

  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('(a) should create nested directories and write bytes (read back and compare)', async () => {
      const testData = Buffer.from('hello world');
      const relPath = 'subdir/nested/file.txt';

      await storage.save(relPath, testData);

      const readData = await readFile(path.join(tempDir, relPath));
      expect(readData).toEqual(testData);
    });

    it('(d) should reject path traversal with .. before touching disk', async () => {
      const testData = Buffer.from('dangerous');

      await expect(storage.save('../escape.txt', testData)).rejects.toThrow(
        /Unsafe media path/,
      );
      await expect(
        storage.save('../../../etc/passwd', testData),
      ).rejects.toThrow(/Unsafe media path/);

      // Nothing was written: the media root has no entries at all (so no
      // escape.txt — or any stray directory — anywhere under it)…
      expect(fs.readdirSync(tempDir, { recursive: true })).toEqual([]);
      // …and nothing landed beside it: `../escape.txt` would resolve into the
      // parent directory, which must still contain only the media root.
      expect(fs.existsSync(path.join(parentDir, 'escape.txt'))).toBe(false);
      expect(fs.readdirSync(parentDir)).toEqual(['media']);
    });
  });

  describe('publicUrl', () => {
    it('(b) should join base url with relative path', () => {
      const relPath = 'a/b.jpg';
      const expectedUrl = 'http://localhost:3001/media/a/b.jpg';

      const result = storage.publicUrl(relPath);
      expect(result).toBe(expectedUrl);
    });
  });

  describe('remove', () => {
    it('(c) should delete file and be idempotent (no throw when missing)', async () => {
      const relPath = 'test.txt';
      const testData = Buffer.from('test content');

      // Save a file
      await storage.save(relPath, testData);

      // Remove should succeed
      await expect(storage.remove(relPath)).resolves.toBeUndefined();

      // Second remove should not throw (idempotent)
      await expect(storage.remove(relPath)).resolves.toBeUndefined();
    });
  });
});
