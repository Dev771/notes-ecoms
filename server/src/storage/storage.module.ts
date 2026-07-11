import { Global, Module } from '@nestjs/common';
import * as path from 'node:path';
import { LocalDiskStorage } from './local-disk.storage';
import { STORAGE_PROVIDER } from './storage.provider';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: () =>
        new LocalDiskStorage(
          process.env.MEDIA_DIR ?? path.join(process.cwd(), 'media'),
          process.env.PUBLIC_MEDIA_BASE ?? 'http://localhost:3001/media',
        ),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
