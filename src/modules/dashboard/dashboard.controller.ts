import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardOverviewService } from './dashboard-overview.service';

export class OverviewQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the active season' }) @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional({ description: 'Omit for every location' }) @IsOptional() @IsUUID() locationId?: string;
}

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService, private readonly overviewSvc: DashboardOverviewService) {}

  @Get('overview') @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'The dashboard: players, coaches, attendance, schedule and (with finance access) revenue, kits and unpaid' })
  overview(@Query() q: OverviewQueryDto, @CurrentUser() user: AuthUser) {
    const p = user?.permissions ?? [];
    const finance = p.includes('*') || p.includes('invoice.view');
    return this.overviewSvc.overview(q, { finance });
  }

  @Get() @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'KPIs, work queue, upcoming sessions, capacity and recent activity' })
  summary() { return this.dashboard.summary(); }

  @Get('kpis') @RequirePermissions('dashboard.view')
  kpis() { return this.dashboard.kpis(); }

  @Get('pending-actions') @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Actionable work queue — each item links to where to act' })
  pending() { return this.dashboard.pendingActions(); }

  @Get('upcoming-sessions') @RequirePermissions('dashboard.view')
  upcoming(@Query('days') days?: string) { return this.dashboard.upcomingSessions(days ? +days : 2); }
}
