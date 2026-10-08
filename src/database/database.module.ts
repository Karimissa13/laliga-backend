import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as entities from './entities';

/**
 * Database connection.
 *
 * Serverless note: on Vercel each warm function instance holds its own pool, so
 * a normal pool size would exhaust Postgres' connection limit under any traffic.
 * When running serverless we keep the pool tiny and let the provider's pooler
 * (Neon/Supabase pgBouncer) do the multiplexing — point DATABASE_URL at the
 * POOLED connection string there, not the direct one.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const serverless = !!process.env.VERCEL;
        const url = config.get<string>('database.url');
        const needsSsl = /neon\.tech|supabase|render\.com|amazonaws\.com|sslmode=require/.test(url ?? '');

        return {
          type: 'postgres' as const,
          url,
          entities: Object.values(entities).filter((e: any) => typeof e === 'function') as any,
          // Never auto-sync a serverless deployment on every cold start.
          synchronize: serverless ? false : config.get<boolean>('database.synchronize'),
          logging: config.get<boolean>('database.logging'),
          autoLoadEntities: true,
          // Managed Postgres providers terminate non-TLS connections.
          ssl: needsSsl ? { rejectUnauthorized: false } : false,
          extra: serverless
            ? { max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 }
            : { max: 10 },
          // A cold start shouldn't hang forever waiting on the database.
          retryAttempts: serverless ? 1 : 10,
          retryDelay: 1000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
