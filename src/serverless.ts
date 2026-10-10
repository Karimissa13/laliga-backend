/**
 * Vercel serverless entry point, compiled with the rest of the app by `nest build`
 * (so decorators and metadata are emitted exactly as in Docker). `api/index.js`
 * only re-exports this handler.
 *
 * The Nest app is created once per warm function instance and reused.
 * `main.ts` stays the entry point for Docker and local development.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { corsOrigin, prepareVercelRequest } from './common/vercel-request';

let cached: express.Express | null = null;

async function bootstrap(): Promise<express.Express> {
  if (cached) return cached;
  const server = express();
  server.set('trust proxy', 1);
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn'], bodyParser: false });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Only the academy's own sites may call the API from a browser (see corsOrigin).
  app.enableCors({ origin: corsOrigin(), credentials: true });
  // Room for a player's photo on the Advanced report (resized in the browser first).
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  cached = server;
  return server;
}

export default async function handler(req: any, res: any) {
  const server = await bootstrap();
  prepareVercelRequest(req);
  return server(req, res);
}
