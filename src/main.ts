import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

/**
 * Long-running server: Docker, a Node host behind nginx, or local development.
 * (Vercel uses serverless.ts; both share configureApp.) Before starting it on a
 * live database, run `npm run release` (migrations, then setup) — the Docker
 * entrypoint does that itself.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);

  // API explorer: on by default for local work; on the live system only with API_DOCS=true.
  const docs = process.env.API_DOCS ? process.env.API_DOCS === 'true' : process.env.LALIGA_LIVE !== 'true';
  if (docs) {
    const config = new DocumentBuilder()
      .setTitle('LaLiga Academy — Operations Backend API')
      .setDescription('Administration & operations backend for LaLiga Academy Abu Dhabi.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`LaLiga backend running on http://localhost:${port}${docs ? ' (docs at /api/docs)' : ''}`);
}
bootstrap();
