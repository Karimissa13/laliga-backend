import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get() @RequirePermissions('report.view')
  @ApiOperation({ summary: 'Everything at once — enrolment, revenue, capacity, attendance, conversion' })
  overview(@Query() f: any) { return this.analytics.overview(f); }

  @Get('enrolment') @RequirePermissions('report.view')
  enrolment(@Query() f: any) { return this.analytics.enrolment(f); }

  @Get('revenue') @RequirePermissions('report.view')
  @ApiOperation({ summary: 'Billed vs collected vs outstanding, monthly trend, VAT and discounts' })
  revenue(@Query() f: any) { return this.analytics.revenue(f); }

  @Get('capacity') @RequirePermissions('report.view')
  capacity() { return this.analytics.capacity(); }

  @Get('coach-workload') @RequirePermissions('report.view')
  coachWorkload(@Query() f: any) { return this.analytics.coachWorkload(f); }

  @Get('venue-utilisation') @RequirePermissions('report.view')
  venues(@Query() f: any) { return this.analytics.venueUtilisation(f); }

  @Get('attendance') @RequirePermissions('report.view')
  attendance(@Query() f: any) { return this.analytics.attendance(f); }

  @Get('conversion') @RequirePermissions('report.view')
  conversion() { return this.analytics.conversion(); }
}
