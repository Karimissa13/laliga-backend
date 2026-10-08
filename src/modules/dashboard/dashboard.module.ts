import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrolment, Invoice, Lead, Player } from '../../database/entities';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { DashboardOverviewService } from './dashboard-overview.service';
import { FinanceModule } from '../finance/finance.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { DevelopmentModule } from '../development/development.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Player, Invoice, Lead, Enrolment]),
    FinanceModule, SchedulingModule, DevelopmentModule, AnalyticsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardOverviewService],
})
export class DashboardModule {}
