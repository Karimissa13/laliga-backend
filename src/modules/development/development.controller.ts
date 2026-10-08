import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevelopmentService, EVALUATION_CRITERIA } from './development.service';
import { CreateEvaluationDto, RegisterDocumentDto, ReportBoardDto, SaveReportDto } from './dto/development.dto';
import { DevelopmentReportsService } from './reports.service';
import { ReportPdfService } from './report-pdf.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Player Development & Documents')
@Controller()
export class DevelopmentController {
  constructor(
    private readonly dev: DevelopmentService,
    private readonly reports: DevelopmentReportsService,
    private readonly pdf: ReportPdfService,
    private readonly notify: NotificationsService,
  ) {}

  // ---------------- term reports: Development and Advanced ----------------
  @Get('development/templates') @RequirePermissions('evaluation.view')
  @ApiOperation({ summary: 'The Development report (1–5) and the Advanced report (0–5, by position): areas and items' })
  templates() { return this.reports.templates(); }

  @Get('development/board') @RequirePermissions('evaluation.view')
  @ApiOperation({ summary: 'Every child enrolled in a term, the report their squad needs and where it stands' })
  board(@Query() q: ReportBoardDto) { return this.reports.board(q); }

  @Post('development/reports') @RequirePermissions('evaluation.create') @Audit('evaluation.report_start', 'evaluation')
  @ApiOperation({ summary: "Start a child's term report (returns the existing one if already started)" })
  start(@Body() dto: SaveReportDto, @CurrentUser() u: AuthUser) { return this.reports.create(dto as any, { id: u?.id }); }

  @Get('development/reports/:id') @RequirePermissions('evaluation.view')
  getReport(@Param('id', ParseUUIDPipe) id: string) { return this.reports.get(id); }

  @Patch('development/reports/:id') @RequirePermissions('evaluation.edit') @Audit('evaluation.report_save', 'evaluation')
  save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveReportDto, @CurrentUser() u: AuthUser) {
    return this.reports.update(id, dto as any, { id: u?.id });
  }

  @Post('development/reports/:id/final') @RequirePermissions('evaluation.edit') @Audit('evaluation.report_final', 'evaluation')
  @ApiOperation({ summary: 'Lock the report as final (every item scored, comments written)' })
  finalize(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.reports.finalize(id, { id: u?.id }); }

  @Post('development/reports/:id/reopen') @RequirePermissions('evaluation.approve') @Audit('evaluation.report_reopen', 'evaluation')
  reopen(@Param('id', ParseUUIDPipe) id: string) { return this.reports.reopen(id, { canApprove: true }); }

  @Delete('development/reports/:id') @RequirePermissions('evaluation.edit') @Audit('evaluation.report_delete', 'evaluation')
  removeReport(@Param('id', ParseUUIDPipe) id: string) { return this.reports.remove(id); }

  @Get('development/reports/:id/pdf') @RequirePermissions('evaluation.view')
  async reportPdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.pdf.render(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.fileName}"`);
    res.send(r.buffer);
  }

  @Post('development/reports/:id/send') @RequirePermissions('evaluation.approve') @Audit('evaluation.report_send', 'evaluation')
  @ApiOperation({ summary: 'Email the final report to the parent (PDF attached) and show it on their sign-in page' })
  async send(@Param('id', ParseUUIDPipe) id: string) {
    const f = await this.pdf.render(id);
    const r = f.report;
    if (r.status !== 'FINAL') throw new BadRequestException('Make the report final before sending it');
    const first = r.player?.firstName ?? 'your child';
    const kind = r.reportType === 'DEVELOPMENT' ? 'Development' : 'Advanced';
    const subject = `${r.player?.name} — ${r.term} ${kind} report`;
    const text = `Dear parent,\n\nPlease find attached ${first}'s ${kind} report for ${r.term} (${r.season}).${r.coach ? ` It was written by Coach ${r.coach}.` : ''}\n\nYou can also find it any time on the parent sign-in page.\n\nLaLiga Academy Abu Dhabi`;
    const html = text.split('\n\n').map((p) => `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>`).join('');
    const sent = await this.notify.sendDocument({ guardianId: r.player.guardianId, subject, html, text, kind: 'report',
      file: { fileName: f.fileName, buffer: f.buffer }, attachment: { type: 'report', id } });
    await this.reports.markSent(id);
    return { ...sent, report: await this.reports.get(id) };
  }

  @Get('players/:id/reports') @RequirePermissions('evaluation.view')
  playerReports(@Param('id', ParseUUIDPipe) id: string) { return this.reports.forPlayer(id); }


  @Get('evaluations/criteria') @RequirePermissions('evaluation.view')
  criteria() { return { criteria: EVALUATION_CRITERIA, scale: '1–5' }; }

  @Get('evaluations') @RequirePermissions('evaluation.view')
  @ApiOperation({ summary: 'All evaluations across players (the cross-player view the old system lacked)' })
  list(@Query('playerId') playerId?: string, @Query('coachId') coachId?: string, @Query('termId') termId?: string) {
    return this.dev.list({ playerId, coachId, termId });
  }

  @Post('evaluations') @RequirePermissions('evaluation.create') @Audit('evaluation.create', 'evaluation')
  create(@Body() dto: CreateEvaluationDto, @CurrentUser() user: AuthUser) {
    return this.dev.create({ ...dto, evaluatorId: user?.id });
  }

  @Get('players/:id/passport') @RequirePermissions('player.view')
  @ApiOperation({ summary: 'Player Passport — profile, development trend, attendance, history, documents' })
  passport(@Param('id') id: string) { return this.dev.passport(id); }

  // Documents
  @Get('documents') @RequirePermissions('document.view')
  listDocs(@Query('playerId') playerId?: string, @Query('guardianId') guardianId?: string) {
    return this.dev.listDocuments({ playerId, guardianId });
  }
  @Get('documents/expiring') @RequirePermissions('document.view')
  @ApiOperation({ summary: 'Documents expiring within N days (or already expired)' })
  expiring(@Query('days') days?: string) { return this.dev.expiringDocuments(days ? +days : 30); }

  @Post('documents') @RequirePermissions('document.create') @Audit('document.register', 'document')
  @ApiOperation({ summary: 'Register document metadata (binary lives in object storage)' })
  register(@Body() dto: RegisterDocumentDto, @CurrentUser() user: AuthUser) {
    return this.dev.registerDocument({ ...dto, uploadedById: user?.id });
  }
  @Delete('documents/:id') @RequirePermissions('document.delete') @Audit('document.delete', 'document')
  remove(@Param('id') id: string) { return this.dev.removeDocument(id); }
}
