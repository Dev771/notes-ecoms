import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: true, // reflects request origin; tenant validation happens in TenantMiddleware
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.useStaticAssets(
    process.env.MEDIA_DIR ?? path.join(process.cwd(), 'media'),
    { prefix: '/media/' },
  );
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
