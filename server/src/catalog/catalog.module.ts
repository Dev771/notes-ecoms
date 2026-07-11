import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

// CatalogService's dependencies (PrismaService, STORAGE_PROVIDER) are both
// provided by @Global() modules (PrismaModule, StorageModule), so a plain
// class provider is enough here — no useFactory/inject needed, and no
// explicit imports of those modules (see PreviewsModule for the same note).
//
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
