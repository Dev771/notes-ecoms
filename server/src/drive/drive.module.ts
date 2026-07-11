import { Module } from '@nestjs/common';
import { buildDriveClient, DriveService } from './drive.service';

@Module({
  providers: [
    {
      provide: DriveService,
      useFactory: () => new DriveService(buildDriveClient),
    },
  ],
  exports: [DriveService],
})
export class DriveModule {}
