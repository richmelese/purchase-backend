import './env.js';
import 'reflect-metadata';
import * as crypto from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module.js';

const BFF_HEADER = 'x-bff-secret';

// When BFF_SHARED_SECRET is set, only the Next.js backend-for-frontend (which sends the same
// secret) may call the API. The health check stays open for container orchestration.
function requireBffSecret(secret: string): express.RequestHandler {
  const expected = Buffer.from(secret);
  return (req, res, next) => {
    if (req.path === '/api/health') return next();
    const given = Buffer.from(String(req.headers[BFF_HEADER] || ''));
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.status(403).json({ error: 'Direct API access is not allowed' });
  };
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // The browser never talks to this service directly: all traffic arrives through the Next.js BFF,
  // which forwards the client address in X-Forwarded-For (used for login lockout and the audit log).
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');

  const secret = process.env.BFF_SHARED_SECRET;
  if (secret) app.use(requireBffSecret(secret));
  else logger.warn('BFF_SHARED_SECRET is not set – the API accepts requests from any client that can reach it');

  // CORS is off by default (the BFF calls server-to-server). Opt in for tooling with CORS_ORIGIN.
  if (process.env.CORS_ORIGIN) {
    app.enableCors({ origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true });
  }

  app.use(cookieParser());
  // Excel uploads (products, parties, bank statements) arrive as raw bytes.
  app.use(
    express.raw({
      type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      limit: '25mb',
    }),
  );
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  const host = process.env.HOST || '127.0.0.1';

  await app.listen(port, host);
  logger.log(`Backend API running on http://${host}:${port}/api`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
