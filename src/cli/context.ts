import '../env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../app.module.js';

// Boots the backend's services without the HTTP server, for command-line tools.
export async function withAppContext(fn: (app: INestApplicationContext) => Promise<void>) {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}
