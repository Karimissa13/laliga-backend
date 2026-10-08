import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunicationsService } from './communications.service';
import { AutomationsService } from './automations.service';
import { SchedulerService } from './scheduler.service';
import {
  BroadcastDto, CreateTemplateDto, RunAutomationDto, UpdateTemplateDto,
  SetCronDto, SetScheduleEnabledDto,
} from './dto/comms.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Communications & Automations')
@Controller()
export class CommunicationsController {
  constructor(
    private readonly comms: CommunicationsService,
    private readonly automations: AutomationsService,
    private readonly scheduler: SchedulerService,
  ) {}

  // Templates
  @Get('communication-templates') @RequirePermissions('communication.view')
  listTemplates() { return this.comms.listTemplates(); }
  @Post('communication-templates') @RequirePermissions('communication.manage') @Audit('template.create', 'template')
  createTemplate(@Body() dto: CreateTemplateDto) { return this.comms.createTemplate(dto); }
  @Patch('communication-templates/:id') @RequirePermissions('communication.manage') @Audit('template.update', 'template')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) { return this.comms.updateTemplate(id, dto); }

  // Broadcast
  @Post('communications/broadcast') @RequirePermissions('communication.create') @Audit('communication.broadcast', 'communication')
  @ApiOperation({ summary: 'Targeted send by team / age group / payment status / everyone' })
  broadcast(@Body() dto: BroadcastDto) { return this.comms.broadcast(dto as any); }

  @Post('communications/audience-preview') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'Who would receive this — count and names, before sending' })
  async preview(@Body() dto: BroadcastDto) {
    const list = await this.comms.resolveAudience(dto.audience as any);
    return { count: list.length, recipients: list.map((g) => ({ id: g.id, name: g.fullName, email: g.email, mobile: g.mobile })) };
  }

  // History
  @Get('communications') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'Communication history (all, or ?guardianId=)' })
  history(@Query('guardianId') guardianId?: string) { return this.comms.history(guardianId); }

  // Automations
  @Get('automations') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'Available administrative automations' })
  listAutomations() {
    return [
      { key: 'payment-reminders', name: 'Overdue payment reminders', description: 'Emails guardians whose invoices are past due' },
      { key: 'trial-confirmations', name: 'Trial confirmations', description: 'Confirms upcoming booked trials' },
      { key: 'renewal-reminders', name: 'Renewal reminders', description: 'Nudges families before the current term ends' },
      { key: 'registration-confirmations', name: 'Registration welcome', description: 'Welcomes newly registered players' },
    ];
  }

  @Post('automations/payment-reminders') @RequirePermissions('communication.create') @Audit('automation.run', 'automation')
  paymentReminders(@Body() dto: RunAutomationDto) { return this.automations.paymentReminders(dto); }

  @Post('automations/trial-confirmations') @RequirePermissions('communication.create') @Audit('automation.run', 'automation')
  trialConfirmations(@Body() dto: RunAutomationDto) { return this.automations.trialConfirmations(dto); }

  @Post('automations/renewal-reminders') @RequirePermissions('communication.create') @Audit('automation.run', 'automation')
  renewalReminders(@Body() dto: RunAutomationDto) { return this.automations.renewalReminders(dto); }

  @Post('automations/registration-confirmations') @RequirePermissions('communication.create') @Audit('automation.run', 'automation')
  registrationConfirmations(@Body() dto: RunAutomationDto) { return this.automations.registrationConfirmations(dto); }

  // ---- Scheduler (unattended runs) ----
  @Get('automations/schedule') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'Scheduled automation jobs — cron, enabled state, last run, next run' })
  schedule() { return this.scheduler.list(); }

  @Post('automations/schedule/:key/enable') @RequirePermissions('communication.manage') @Audit('scheduler.enable', 'automation')
  @ApiOperation({ summary: 'Turn a scheduled job on or off' })
  setEnabled(@Param('key') key: string, @Body() dto: SetScheduleEnabledDto) {
    return this.scheduler.setEnabled(key, dto.enabled);
  }

  @Post('automations/schedule/:key/cron') @RequirePermissions('communication.manage') @Audit('scheduler.cron', 'automation')
  @ApiOperation({ summary: 'Change a job schedule (cron, Asia/Dubai)' })
  setCron(@Param('key') key: string, @Body() dto: SetCronDto) {
    return this.scheduler.setSchedule(key, dto.cron);
  }

  @Post('automations/schedule/:key/run-now') @RequirePermissions('communication.manage') @Audit('scheduler.run-now', 'automation')
  @ApiOperation({ summary: 'Trigger a scheduled job immediately (sends for real)' })
  async runNow(@Param('key') key: string) {
    await this.scheduler.run(key);
    return this.scheduler.list().find((j) => j.key === key);
  }

  @Post('automations/run-all') @RequirePermissions('communication.manage') @Audit('automation.run-all', 'automation')
  @ApiOperation({ summary: 'Run every automation (dryRun=true by default)' })
  runAll(@Body() dto: RunAutomationDto) { return this.automations.runAll(dto.dryRun ?? true); }
}
