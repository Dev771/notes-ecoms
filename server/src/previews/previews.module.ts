import { Module } from '@nestjs/common';
import { DriveModule } from '../drive/drive.module';
import { PreviewGenerationHandler } from './preview.handler';
import { PreviewService } from './preview.service';

/**
 * Wiring route: this module provides and exports the HANDLER CLASS only.
 * The `JOB_HANDLERS` array token is bound in ONE place — JobsModule — which
 * imports this module and aggregates every handler there. Feature modules
 * must NOT bind JOB_HANDLERS themselves: Nest does not merge same-token
 * providers across sibling modules, so a second module binding the token
 * would silently shadow the first and lose its handlers.
 *
 * The dependency direction only goes one way — PreviewsModule has no need of
 * JobsService — so there's no cycle/forwardRef risk in JobsModule importing
 * this module.
 *
 * PrismaService and STORAGE_PROVIDER don't need to be imported here: both
 * PrismaModule and StorageModule are `@Global()`. DriveModule is not global,
 * so it's imported explicitly for DriveService.
 *
 * PreviewService stays module-private: nothing outside currently needs it
 * (Task 6's planned admin "generate previews" endpoint enqueues a
 * PREVIEW_GENERATION job via JobsService rather than calling PreviewService
 * itself).
 */
@Module({
  imports: [DriveModule],
  providers: [PreviewService, PreviewGenerationHandler],
  exports: [PreviewGenerationHandler],
})
export class PreviewsModule {}
