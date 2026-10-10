import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { corsOrigin } from './common/vercel-request';

/**
 * Everything the app needs around its modules, in one place, used by every way of
 * running it — the Vercel function (serverless.ts), a long-running server or Docker
 * container (main.ts) and the e2e tests — so the live system behaves the same on
 * any host.
 *
 * Create the app with `{ bodyParser: false }`: the body limits are set here.
 */
export function configureApp(app: INestApplication, env: NodeJS.ProcessEnv = process.env) {
  // Behind a proxy (Vercel always; nginx / a load balancer on another host) the client's
  // address comes from X-Forwarded-For. TRUST_PROXY: number of proxies in front (default 1 on
  // Vercel, 0 elsewhere — set it to 1 when the app sits behind nginx).
  const hops = env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '' ? Number(env.TRUST_PROXY) : env.VERCEL ? 1 : 0;
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);

  // Security headers (HSTS/CSP/etc.). scriptSrc stays locked to 'self' (no
  // unsafe-inline): the admin UI ships its JS as a file and dispatches actions
  // through event delegation. Inline style attributes are used for data-driven widths.
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
  app.enableCors({ origin: corsOrigin(env), credentials: true });
  // Room for a player's photo on the Advanced report (resized in the browser first).
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}
