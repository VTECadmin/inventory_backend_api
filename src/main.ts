// Load .env before anything else so modules that read process.env at import
// time (e.g. the Cognito strategy) see the configured values. In production the
// systemd unit also injects these; dotenv does not override already-set vars.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Fail fast in production if critical configuration is missing, rather than
  // silently falling back to hardcoded defaults (e.g. the wrong Cognito pool or
  // a default DB) — the class of bug that caused the three-pools incident.
  if (process.env.NODE_ENV === 'production') {
    const required = [
      'COGNITO_USER_POOL_ID',
      'COGNITO_CLIENT_ID',
      'DB_HOST',
      'DB_NAME',
      'DB_USER',
      'DB_PASSWORD',
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
    }
  }

  const app = await NestFactory.create(AppModule);

  // Baseline security headers on every response (dependency-free). The API only
  // ever serves JSON to the dashboard's XHR calls, so framing is denied outright.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

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
  // Close the app cleanly on SIGTERM/SIGINT (e.g. systemctl restart), so the DB
  // pool and open connections are released instead of being killed abruptly.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
