import { Module } from '@nestjs/common';
import { DriveModule } from '../drive/drive.module';
import { JobsModule } from '../jobs/jobs.module';
import { AdminProductsController } from './admin-products.controller';

// RolesGuard/JwtAuthGuard are referenced via @UseGuards() on the controller
// by class reference, not listed here — same pattern as every other guard
// in this codebase (e.g. JwtAuthGuard is never in a `providers` array).
// Nest resolves them through its DI container at the controller's host
// module regardless; RolesGuard's only dependency (Reflector) is a
// framework-global provider available without explicit registration.
@Module({
  imports: [DriveModule, JobsModule],
  controllers: [AdminProductsController],
})
export class AdminModule {}
