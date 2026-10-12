import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Transform } from 'class-transformer';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { numParam } from '../../common/query-params';
import { FinanceReportsService } from '../finance/finance-reports.service';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardOverviewService } from './dashboard-overview.service';

export class OverviewQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the active season' }) @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional({ description: 'Omit for every location' }) @IsOptional() @IsUUID() locationId?: string;
}

export class KitSalesQueryDto extends OverviewQueryDto {
  @ApiPropertyOptional({ enum: ['HOME', 'AWAY', 'TOP', 'TRAINING', 'GOALKEEPER'] })
  @IsOptional() @IsIn(['HOME', 'AWAY', 'TOP', 'TRAINING', 'GOALKEEPER']) type?: string;
}

export class WalletLedgerQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['CREDIT', 'DEBIT'] }) @IsOptional() @IsIn(['CREDIT', 'DEBIT']) type?: string;
  @ApiPropertyOptional({ description: 'Family name, PR- number, mobile or reason' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Transform(numParam) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @Transform(numParam) @IsInt() @Min(1) @Max(500) limit?: number;
}

const dmy = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

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

  @Get('revenue') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Revenue in detail (behind the Total revenue card): by month, term and category, by stream, collected and pending' })
  revenue(@Query() q: OverviewQueryDto) { return this.overviewSvc.revenueReport(q); }

  @Get('kit-sales') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Every kit sold this season, piece by piece (behind the Kits sales card)' })
  kitSales(@Query() q: KitSalesQueryDto) { return this.overviewSvc.kitSales(q); }

  @Get('wallet-ledger') @RequirePermissions('wallet.view')
  @ApiOperation({ summary: 'Every family wallet credit and debit, with the balance after each (behind the Wallet balance card)' })
  walletLedger(@Query() q: WalletLedgerQueryDto) { return this.overviewSvc.walletLedger(q); }

  @Get('wallet-ledger.csv') @RequirePermissions('wallet.view')
  async walletLedgerCsv(@Query() q: WalletLedgerQueryDto, @Res() res: Response) {
    const r = await this.overviewSvc.walletLedger({ ...q, page: 1, limit: 100000 });
    const csv = FinanceReportsService.toCsv(
      ['Date', 'Parent No', 'Parent', 'Mobile', 'Type', 'Amount', 'Balance After', 'Reason', 'Invoice No', 'Wallet Balance Today'],
      r.data.map((t: any) => [dmy(t.date), t.parentRef, t.parent, t.mobile, t.type === 'CREDIT' ? 'Credit' : 'Debit',
        (t.type === 'CREDIT' ? t.amount : -t.amount).toFixed(2), Number(t.balanceAfter).toFixed(2), t.reason ?? '', t.invoiceNumber ?? '',
        Number(t.walletBalance).toFixed(2)]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Wallet-ledger.csv"');
    res.send(csv);
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
