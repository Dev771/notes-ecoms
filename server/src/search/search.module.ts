import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

// SearchService's dependencies (PrismaService, STORAGE_PROVIDER) are both
// provided by @Global() modules (PrismaModule, StorageModule), so a plain
// class provider is enough here — no useFactory/inject needed, same
// reasoning as CatalogModule/PreviewsModule.
//
@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
