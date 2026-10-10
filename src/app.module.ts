import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { ReferenceModule } from './common/reference.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PeopleModule } from './modules/people/people.module';
import { StructureModule } from './modules/structure/structure.module';
import { TeamsModule } from './modules/teams/teams.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DevelopmentModule } from './modules/development/development.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuditViewModule } from './modules/audit-view/audit-view.module';
import { HealthController } from './health.controller';

import { PlayerDeskModule } from './modules/player-desk/player-desk.module';
import { AcademyCalendarModule } from './modules/academy-calendar/academy-calendar.module';
import { DomainEventsModule } from './common/domain-events';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ParentPortalModule } from './modules/parent-portal/parent-portal.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PaymentLinksModule } from './modules/payment-links/payment-links.module';
import { InvoiceBulkModule } from './modules/invoice-bulk/invoice-bulk.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Serve the admin UI (public/) at the root; API stays under /api.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      // @nestjs/serve-static 4 matches with path-to-regexp 0.x: "/api/(.*)" (the newer "{*splat}"
      // syntax never matched, so unknown /api/... addresses answered with the admin page instead of 404).
      exclude: ['/api/(.*)'],
    }),
    JwtModule.register({ global: true }),
    DatabaseModule,
    AuditModule,
    ReferenceModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PeopleModule,
    StructureModule,
    TeamsModule,
    RegistrationModule,
    SchedulingModule,
    FinanceModule,
    CommunicationsModule,
    AnalyticsModule,
    DevelopmentModule,
    DashboardModule,
    AuditViewModule,
    PlayerDeskModule,
    AcademyCalendarModule,
    DomainEventsModule,
    NotificationsModule,
    ParentPortalModule,
    InventoryModule,
    PaymentLinksModule,
    InvoiceBulkModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global: authenticate everything, then check permissions, then audit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
