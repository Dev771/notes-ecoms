import { Module } from '@nestjs/common';
import { PreviewGenerationHandler } from '../previews/preview.handler';
import { PreviewsModule } from '../previews/previews.module';
import { JOB_HANDLERS } from './job-handler';
import { JobsService } from './jobs.service';
import { JobsWorker } from './jobs.worker';

@Module({
  imports: [PreviewsModule],
  providers: [
    JobsService,
    JobsWorker,
    // Aggregate ALL job handlers here; sibling modules must not bind
    // JOB_HANDLERS themselves (Nest doesn't merge same-token providers across
    // modules — a second binding would silently shadow this one). To add a
    // handler: import its module above, export the handler class from it,
    // then extend `inject` and the returned array.
    {
      provide: JOB_HANDLERS,
      useFactory: (preview: PreviewGenerationHandler) => [preview],
      inject: [PreviewGenerationHandler],
    },
  ],
  exports: [JobsService],
})
export class JobsModule {}
