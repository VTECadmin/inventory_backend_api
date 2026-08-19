import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Restrict cross-origin access to the dashboard (production and dev) plus the
  // local development ports. Override with the CORS_ORIGINS env (comma-separated).
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    'https://internal.vtecdashboard.com,https://dev-internal.vtecdashboard.com,http://localhost:4200,http://localhost:4300'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
  // Allow larger JSON bodies for CSV import (default is 100kb).
  app.use(json({ limit: '5mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
