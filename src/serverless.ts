/**
 * Vercel serverless entry point, compiled with the rest of the app by `nest build`
 * (so decorators and metadata are emitted exactly as in Docker). `api/index.js`
 * only re-exports this handler.
 *
 * The Nest app is created once per warm function instance and reused.
 * `main.ts` is the entry point for every other host (Docker, a Node server, local
 * development); both use the same configureApp, so they behave the same.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';
import { prepareVercelRequest } from './common/vercel-request';

let cached: express.Express | null = null;

async function bootstrap(): Promise<express.Express> {
  if (cached) return cached;
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn'], bodyParser: false });
  configureApp(app);
  await app.init();
  cached = server;
  return server;
}

export default async function handler(req: any, res: any) {
  const server = await bootstrap();
  prepareVercelRequest(req);
  return server(req, res);
}
