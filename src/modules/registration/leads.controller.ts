import {
  BadRequestException, Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested, validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { LeadSource, LeadStatus } from '../../database/entities';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettingsService } from '../finance/settings.service';
import { FinanceReportsService } from '../finance/finance-reports.service';
import { MailerService } from '../notifications/mailer.service';
import { LEAD_STAGE_LABEL, LeadsService } from './leads.service';
import { ConvertLeadDto } from './dto/registration.dto';
import { DEFAULT_LEAD_OUTCOMES, DEFAULT_LEAD_TEMPLATES, LeadTemplate, fill, whatsappLink } from './lead-messages';
import { TrialsService } from './trials.service';
import { boolParam, emptyToUndefined, numParam } from '../../common/query-params';


/** What the website's "Book a Free Trial" pop-up sends. */
export class TrialRequestDto {
  @ApiProperty({ example: 'Sara Ahmed' }) @IsString() @MinLength(2) @MaxLength(120) guardianName: string;
  @ApiPropertyOptional({ example: 'sara@example.com' }) @IsOptional() @Transform(emptyToUndefined) @IsEmail() guardianEmail?: string;
  @ApiProperty({ example: 'Omar' }) @IsString() @MinLength(1) @MaxLength(160) playerName: string;
  @ApiProperty({ example: '+971501234567' }) @IsString() @MinLength(7) @MaxLength(25) guardianMobile: string;
  @ApiProperty({ example: '14/03/2015', description: 'DD/MM/YYYY or YYYY-MM-DD' }) @IsString() @MaxLength(12) playerDob: string;
  @ApiPropertyOptional() @IsOptional() @Transform(boolParam) @IsBoolean() isGuardian?: boolean;
  @ApiPropertyOptional({ description: 'Page or campaign the form was on' }) @IsOptional() @IsString() @MaxLength(200) sourceDetail?: string;
  /** Honeypot: hidden on the real form, so anything here is a bot. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class StaffLeadDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) guardianName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndefined) @IsEmail() guardianEmail?: string;
  @ApiProperty() @IsString() @MinLength(7) @MaxLength(25) guardianMobile: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) playerName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(12) playerDob?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ageGroupLabel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
  @ApiPropertyOptional({ enum: LeadSource }) @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trialDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() venueLabel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE'] }) @IsOptional() @IsIn(['MALE', 'FEMALE']) playerGender?: string;
}
export class UpdateLeadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) guardianName?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => o.guardianEmail !== '' && o.guardianEmail !== null) @IsEmail() guardianEmail?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(7) @MaxLength(25) guardianMobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(160) playerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) playerDob?: string;
  @ApiPropertyOptional({ enum: LeadSource }) @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE'] }) @IsOptional() @IsIn(['MALE', 'FEMALE']) playerGender?: string;
}
export class LeadListDto {
  @ApiPropertyOptional({ enum: [...Object.values(LeadStatus), 'OPEN', 'DUE'] }) @IsOptional() @IsIn([...Object.values(LeadStatus), 'OPEN', 'DUE']) status?: any;
  @ApiPropertyOptional({ enum: LeadSource }) @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @ApiPropertyOptional({ description: 'User id, or "none"' }) @IsOptional() @IsString() assignedToId?: string;
  @ApiPropertyOptional({ example: 'U12' }) @IsOptional() @IsString() @MaxLength(10) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() createdFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() createdTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trialFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trialTo?: string;
  @ApiPropertyOptional({ enum: ['yes', 'no'] }) @IsOptional() @IsIn(['yes', 'no']) hasComments?: 'yes' | 'no';
  @ApiPropertyOptional() @IsOptional() @Transform(numParam) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(numParam) @IsInt() @Min(1) @Max(200) limit?: number;
}
export class LeadStatusDto {
  @ApiProperty({ enum: LeadStatus }) @IsEnum(LeadStatus) status: LeadStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trialDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ description: 'Why they are not joining (required for LOST)' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class LeadActivityDto {
  @ApiProperty({ enum: ['COMMENT', 'CALL', 'WHATSAPP', 'EMAIL', 'SMS'] }) @IsIn(['COMMENT', 'CALL', 'WHATSAPP', 'EMAIL', 'SMS']) type: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @ApiPropertyOptional({ example: 'NO_ANSWER', description: 'For calls: ANSWERED, NO_ANSWER, BUSY, WRONG_NUMBER' }) @IsOptional() @IsString() @MaxLength(30) outcome?: string;
  @ApiPropertyOptional({ description: 'Next follow-up (ISO date-time); null clears it' }) @IsOptional() @ValidateIf((o) => o.nextFollowUpAt !== null) @IsDateString() nextFollowUpAt?: string | null;
}
export class FollowUpDto {
  @ApiPropertyOptional({ description: 'ISO date-time; null clears it' }) @ValidateIf((o) => o.at !== null) @IsDateString() at: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AssignLeadOwnerDto {
  @ApiPropertyOptional({ description: 'User id; null unassigns' }) @IsOptional() @IsUUID() assignedToId?: string | null;
}
export class BookTrialDto {
  @ApiProperty({ description: 'A training session of the team the child will try with' }) @IsUUID() sessionId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class TrialResultDto {
  @ApiProperty({ enum: ['ATTENDED', 'NO_SHOW'] }) @IsIn(['ATTENDED', 'NO_SHOW']) outcome: 'ATTENDED' | 'NO_SHOW';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
  @ApiPropertyOptional({ example: 'Development' }) @IsOptional() @IsString() @MaxLength(40) recommendedLevel?: string;
}
export class ConvertedDto { @ApiProperty() @IsUUID() playerId: string; }
export class ComposeDto { @ApiProperty() @IsString() @MaxLength(40) template: string; }
export class SendMessageDto {
  @ApiProperty({ enum: ['WHATSAPP', 'EMAIL'] }) @IsIn(['WHATSAPP', 'EMAIL']) channel: 'WHATSAPP' | 'EMAIL';
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(4000) text: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) template?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => o.nextFollowUpAt !== null) @IsDateString() nextFollowUpAt?: string | null;
}
class TemplateDto {
  @IsString() @MaxLength(40) key: string;
  @IsString() @MaxLength(60) label: string;
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(2000) text: string;
}
export class TemplatesDto { @ApiProperty({ type: [TemplateDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TemplateDto) templates: TemplateDto[]; }

export class TrialBoardDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-14' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['DEVELOPMENT', 'ADVANCED'] }) @IsOptional() @IsIn(['DEVELOPMENT', 'ADVANCED']) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToId?: string;
  @ApiPropertyOptional({ enum: ['YES', 'NO', 'ANOTHER', 'PENDING'] }) @IsOptional() @IsIn(['YES', 'NO', 'ANOTHER', 'PENDING']) attended?: string;
  @ApiPropertyOptional({ enum: ['needed', 'evaluation'], description: 'needed = came but no follow-up outcome yet; evaluation = came but no coach evaluation' })
  @IsOptional() @IsIn(['needed', 'evaluation']) followUp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class TrialSheetDto {
  @ApiPropertyOptional({ enum: ['DEVELOPMENT', 'ADVANCED'] }) @IsOptional() @IsIn(['DEVELOPMENT', 'ADVANCED']) trialType?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trialConfirmed?: boolean;
  @ApiPropertyOptional({ description: 'Coach id; null clears' }) @IsOptional() @ValidateIf((o) => o.trialCoachId !== null) @IsUUID() trialCoachId?: string | null;
  @ApiPropertyOptional({ enum: ['YES', 'NO', 'ANOTHER', 'PENDING'] }) @IsOptional() @IsIn(['YES', 'NO', 'ANOTHER', 'PENDING']) attended?: string;
  @ApiPropertyOptional({ enum: ['DEVELOPMENT', 'ADVANCED', 'HPC', 'ADV_INVITE', 'NOT_READY'] }) @IsOptional() @ValidateIf((o) => o.trialEvaluation !== null) @IsIn(['DEVELOPMENT', 'ADVANCED', 'HPC', 'ADV_INVITE', 'NOT_READY']) trialEvaluation?: string | null;
  @ApiPropertyOptional({ description: 'Who follows up (user id); null clears' }) @IsOptional() @ValidateIf((o) => o.assignedToId !== null) @IsUUID() assignedToId?: string | null;
  @ApiPropertyOptional({ example: 'All details given, interested — invoice issued and sent' }) @IsOptional() @ValidateIf((o) => o.followUpOutcome !== null) @IsString() @MaxLength(200) followUpOutcome?: string | null;
  @ApiPropertyOptional({ default: true, description: 'Also write the follow-up as a dated comment' }) @IsOptional() @IsBoolean() logComment?: boolean;
}
class RatingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(5) technical?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) tactical?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) physical?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) attitude?: number;
}
export class EvaluationDto {
  @ApiProperty({ enum: ['DEVELOPMENT', 'ADVANCED', 'HPC', 'ADV_INVITE', 'NOT_READY'] }) @IsIn(['DEVELOPMENT', 'ADVANCED', 'HPC', 'ADV_INVITE', 'NOT_READY']) recommendation: string;
  @ApiPropertyOptional({ type: RatingsDto }) @IsOptional() @ValidateNested() @Type(() => RatingsDto) ratings?: RatingsDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) strengths?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) toImprove?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() recommendedTeamId?: string;
  @ApiPropertyOptional({ description: 'Came, but the coach wants to see them again' }) @IsOptional() @IsBoolean() anotherTrial?: boolean;
}
export class OutcomesDto { @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(80) @IsString({ each: true }) @MaxLength(200, { each: true }) outcomes: string[]; }

/** Website form: at most 8 requests per address per hour. */
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k);
  return recent.length > 8;
}

const dubai = (d: Date) => ({
  day: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' }),
  time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }),
});

@ApiTags('Trials & Leads')
@Controller()
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
    private readonly trials: TrialsService,
  ) {}

  // ---------------- the website ----------------
  @Public() @Post('public/trial-requests') @HttpCode(201)
  @ApiOperation({ summary: 'Website "Book a Free Trial" pop-up → a new lead (no sign-in; rate-limited)' })
  @ApiBody({ type: TrialRequestDto })
  async trialRequest(@Body() raw: Record<string, any>, @Ip() ip: string) {
    // Validated here rather than by the global pipe so the website's extra
    // hidden fields (captcha token, tracking) are ignored instead of rejected.
    const dto = plainToInstance(TrialRequestDto, raw ?? {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    if (dto.website) return { ok: true };                     // bot: pretend all is well
    if (rateLimited(ip || 'unknown')) throw new BadRequestException('Too many requests — please call us instead');
    const lead = await this.leads.create({ ...dto, source: LeadSource.POPUP });
    return { ok: true, reference: lead.reference };
  }

  // ---------------- the desk ----------------
  @Get('leads') @RequirePermissions('lead.view')
  @ApiOperation({ summary: 'Leads, open first, ordered by next follow-up' })
  list(@Query() q: LeadListDto) { return this.leads.list(q); }

  @Get('leads/stats') @RequirePermissions('lead.view')
  stats() { return this.leads.stats(); }

  @Get('leads/funnel') @RequirePermissions('lead.view')
  funnel() { return this.leads.funnel(); }

  @Get('leads/owners') @RequirePermissions('lead.view')
  owners() { return this.leads.owners(); }

  @Get('leads/templates') @RequirePermissions('lead.view')
  async templates() { return this.settings.get<{ templates: LeadTemplate[] }>('leadTemplates', { templates: DEFAULT_LEAD_TEMPLATES }); }

  @Put('leads/templates') @RequirePermissions('lead.edit') @Audit('lead.templates', 'settings')
  setTemplates(@Body() dto: TemplatesDto) { return this.settings.set('leadTemplates', { templates: dto.templates }); }

  // ---------------- the trials sheet ----------------
  @Get('leads/trials') @RequirePermissions('lead.view')
  @ApiOperation({ summary: 'Trials by date: confirmation, coach, attended, evaluation, follow-up by, follow-up outcome' })
  trialBoard(@Query() q: TrialBoardDto) { return this.trials.board(q); }

  @Get('leads/outcomes') @RequirePermissions('lead.view')
  outcomes() { return this.settings.get<{ outcomes: string[] }>('leadOutcomes', { outcomes: DEFAULT_LEAD_OUTCOMES }); }

  @Put('leads/outcomes') @RequirePermissions('lead.edit') @Audit('lead.outcomes', 'settings')
  setOutcomes(@Body() dto: OutcomesDto) { return this.settings.set('leadOutcomes', { outcomes: dto.outcomes.map((o) => o.trim()).filter(Boolean) }); }

  @Patch('leads/:id/trial-sheet') @RequirePermissions('lead.edit') @Audit('lead.trial_sheet', 'lead')
  @ApiOperation({ summary: 'Change one cell of the trials sheet for this lead' })
  trialSheet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TrialSheetDto, @CurrentUser() u: AuthUser) {
    return this.trials.updateSheet(id, dto, u?.id);
  }

  @Get('leads/:id/evaluations') @RequirePermissions('lead.view')
  evaluations(@Param('id', ParseUUIDPipe) id: string) { return this.trials.evaluationsFor(id); }

  @Post('leads/:id/evaluations') @RequirePermissions('lead.view', 'evaluation.create') @Audit('lead.evaluation', 'lead')
  @ApiOperation({ summary: "The coach's evaluation of the trial (recommended level, 1–5 ratings, strengths, what to work on)" })
  evaluate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EvaluationDto, @CurrentUser() u: AuthUser) {
    return this.trials.evaluate(id, dto as any, u?.id);
  }

  @Get('leads.csv') @RequirePermissions('lead.export')
  async csv(@Query() q: LeadListDto, @Res() res: Response) {
    const r = await this.leads.list({ ...q, limit: 200, page: 1 });
    let rows = r.data;
    for (let p = 2; p <= Math.min(r.meta.pages, 50); p++) rows = rows.concat((await this.leads.list({ ...q, limit: 200, page: p })).data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Trials-and-leads.csv"');
    res.send(FinanceReportsService.toCsv(
      ['Track No', 'Received', 'Parent', 'Email', 'Mobile', 'Child', 'DOB', 'Category', 'Stage', 'Source', 'Trial', 'Trial team', 'Trial result',
        'Next follow-up', 'Assigned to', 'Contact attempts', 'Not joining because', 'Last activity'],
      rows.map((l: any) => [l.reference, new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }), l.guardianName, l.guardianEmail,
        l.guardianMobile, l.playerName, l.playerDob, l.ageGroupLabel, LEAD_STAGE_LABEL[l.status as LeadStatus], l.source,
        l.trialDate ? new Date(l.trialDate).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }) : '', l.trialTeamName, l.trialOutcome,
        l.nextFollowUpAt ? new Date(l.nextFollowUpAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }) : '', l.assignedToName,
        l.contactAttempts, l.lostReason, l.lastActivity ? `${l.lastActivity.type}: ${l.lastActivity.body ?? ''}` : ''])));
  }

  @Get('leads/:id') @RequirePermissions('lead.view')
  getLead(@Param('id', ParseUUIDPipe) id: string) { return this.leads.findOne(id); }

  @Get('leads/:id/detail') @RequirePermissions('lead.view')
  @ApiOperation({ summary: 'The lead with its timeline, possible duplicates, existing family and trial' })
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.leads.detail(id); }

  @Post('leads') @RequirePermissions('lead.create') @Audit('lead.create', 'lead')
  @ApiOperation({ summary: 'Add an enquiry by hand (call, walk-in, chat)' })
  create(@Body() dto: StaffLeadDto, @CurrentUser() u: AuthUser) {
    return this.leads.create({ ...dto, source: dto.source ?? LeadSource.ENQUIRY }, u?.id);
  }

  @Patch('leads/:id') @RequirePermissions('lead.edit') @Audit('lead.update', 'lead')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto, @CurrentUser() u: AuthUser) {
    return this.leads.update(id, dto as any, u?.id);
  }

  @Patch('leads/:id/status') @RequirePermissions('lead.edit') @Audit('lead.status', 'lead')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeadStatusDto, @CurrentUser() u: AuthUser) {
    return this.leads.updateStatus(id, dto.status, dto, u?.id);
  }

  @Patch('leads/:id/assign') @RequirePermissions('lead.edit') @Audit('lead.assign', 'lead')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignLeadOwnerDto, @CurrentUser() u: AuthUser) {
    return this.leads.assign(id, dto.assignedToId ?? null, u?.id);
  }

  @Post('leads/:id/activities') @RequirePermissions('lead.edit') @Audit('lead.activity', 'lead')
  @ApiOperation({ summary: 'Add a comment or log a call / WhatsApp / email (optionally set the next follow-up)' })
  activity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeadActivityDto, @CurrentUser() u: AuthUser) {
    return this.leads.addActivity(id, dto, u?.id);
  }

  @Patch('leads/:id/follow-up') @RequirePermissions('lead.edit') @Audit('lead.follow_up', 'lead')
  followUp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FollowUpDto, @CurrentUser() u: AuthUser) {
    return this.leads.setFollowUp(id, dto.at, dto.note, u?.id);
  }

  @Get('leads/:id/trial-slots') @RequirePermissions('lead.view')
  @ApiOperation({ summary: 'Upcoming training sessions of teams that take the child\'s category' })
  slots(@Param('id', ParseUUIDPipe) id: string) { return this.leads.trialSlots(id); }

  @Post('leads/:id/trial') @RequirePermissions('lead.edit') @Audit('lead.trial_booked', 'lead')
  book(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BookTrialDto, @CurrentUser() u: AuthUser) {
    return this.leads.bookTrial(id, dto, u?.id);
  }

  @Post('leads/:id/trial-result') @RequirePermissions('lead.edit') @Audit('lead.trial_result', 'lead')
  result(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TrialResultDto, @CurrentUser() u: AuthUser) {
    return this.leads.trialResult(id, dto, u?.id);
  }

  @Post('leads/:id/converted') @RequirePermissions('registration.create') @Audit('lead.convert', 'lead')
  @ApiOperation({ summary: 'Link the lead to the child registered from it (Register a child → Joined)' })
  converted(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertedDto, @CurrentUser() u: AuthUser) {
    return this.leads.markConverted(id, dto.playerId, u?.id);
  }

  /** Fill a template with this lead's details; returns the text and a WhatsApp link. */
  @Post('leads/:id/compose') @RequirePermissions('lead.view')
  async compose(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ComposeDto, @CurrentUser() u: AuthUser) {
    const d = await this.leads.detail(id);
    const { templates } = await this.templates();
    const t = templates.find((x) => x.key === dto.template);
    if (!t) throw new BadRequestException('Unknown template');
    const [me] = await (this.leads as any).ds.query(`SELECT "fullName" FROM users WHERE id = $1`, [u?.id]);
    const when = d.trialSession?.startsAt ? dubai(new Date(d.trialSession.startsAt)) : d.lead.trialDate ? dubai(new Date(d.lead.trialDate)) : null;
    const vars = {
      parent: d.lead.guardianName.split(' ')[0], child: d.lead.playerName.split(' ')[0], staff: me?.fullName?.split(' ')[0] ?? 'LaLiga Academy',
      trialDay: when?.day, trialTime: when?.time, team: d.trialTeam?.name, venue: d.trialSession?.location?.replace(/^Abu Dhabi\s*-\s*/i, '') ?? 'Active Al Maryah',
      level: d.lead.level ?? 'Development',
    };
    const text = fill(t.text, vars);
    return { template: t.key, subject: fill(t.subject, vars), text, whatsappUrl: whatsappLink(d.lead.guardianMobile, text), canEmail: !!d.lead.guardianEmail };
  }

  /** Record a WhatsApp the desk is sending, or send an email now. */
  @Post('leads/:id/message') @RequirePermissions('lead.edit') @Audit('lead.message', 'lead')
  async message(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @CurrentUser() u: AuthUser) {
    const lead = await this.leads.findOne(id);
    let sent: any = null;
    if (dto.channel === 'EMAIL') {
      if (!lead.guardianEmail) throw new BadRequestException('This lead has no email address');
      const n = await this.settings.notifications();
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${dto.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</div>`;
      sent = await this.mailer.send({ to: lead.guardianEmail, subject: dto.subject || 'LaLiga Academy Abu Dhabi', html, text: dto.text, fromName: n.fromName, replyTo: n.replyTo });
      if (!sent.ok) throw new BadRequestException('Email failed: ' + (sent.error ?? ''));
    }
    const detail = await this.leads.addActivity(id, {
      type: dto.channel, body: dto.text, outcome: dto.channel === 'EMAIL' ? (sent?.simulated ? 'NOT_SENT_EMAIL_NOT_CONNECTED' : 'SENT') : 'OPENED_WHATSAPP',
      nextFollowUpAt: dto.nextFollowUpAt,
    }, u?.id);
    return { ...detail, emailed: dto.channel === 'EMAIL' ? { sent: !sent?.simulated, simulated: !!sent?.simulated } : null };
  }

  @Post('leads/:id/convert') @RequirePermissions('registration.create') @Audit('lead.convert', 'lead')
  @ApiOperation({ summary: 'Quick convert into a guardian + player (the desk normally uses Register a child)' })
  convert(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertLeadDto, @CurrentUser() u: AuthUser) {
    return this.leads.convert(id, dto, u?.id);
  }
}
