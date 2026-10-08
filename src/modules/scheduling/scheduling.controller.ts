import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { AttendanceService } from './attendance.service';
import {
  CreateSessionDto, GenerateSessionsDto, MarkAttendanceDto, UpdateSessionDto,
} from './dto/scheduling.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { SeasonScheduleService } from './season-schedule.service';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class GenerateSeasonDto {
  @ApiPropertyOptional({ description: 'Defaults to the active season' }) @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) teamIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ description: 'Also remove future, unmarked sessions that no longer fit the schedule' })
  @IsOptional() @IsBoolean() sync?: boolean;
}
export class CancelSessionDto {
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() cancelled?: boolean;
  @ApiPropertyOptional({ example: 'Pitch closed — heat warning' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
export class GridQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Scheduling & Attendance')
@Controller()
export class SchedulingController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly attendance: AttendanceService,
    private readonly season: SeasonScheduleService,
  ) {}

  // ---- Season schedule (every team, 31 Aug 2026 – 11 Jun 2027) ----
  @Post('schedule/season/generate') @RequirePermissions('session.create') @Audit('session.season_generate', 'session')
  @ApiOperation({ summary: "Create each team's training sessions for the season from its days and times (safe to re-run)" })
  generateSeason(@Body() dto: GenerateSeasonDto) { return this.season.generate(dto); }

  @Post('teams/:id/sessions/sync') @RequirePermissions('session.create') @Audit('session.team_sync', 'team')
  @ApiOperation({ summary: "Re-plan a team's future sessions after its training days or times change" })
  syncTeam(@Param('id', ParseUUIDPipe) id: string) {
    return this.season.generate({ teamIds: [id], from: new Date().toISOString().slice(0, 10), sync: true });
  }

  @Get('teams/:id/attendance-grid') @RequirePermissions('attendance.view')
  @ApiOperation({ summary: "A team's register for a period: sessions × children, with season-to-date rates" })
  grid(@Param('id', ParseUUIDPipe) id: string, @Query() q: GridQueryDto) { return this.season.teamGrid(id, q.from, q.to); }

  @Get('attendance/day') @RequirePermissions('attendance.view')
  @ApiOperation({ summary: "Every session on a day with its register progress (default today, Abu Dhabi time)" })
  day(@Query('date') date?: string) { return this.season.day(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined); }

  @Patch('sessions/:id/cancel') @RequirePermissions('session.edit') @Audit('session.cancel', 'session')
  @ApiOperation({ summary: 'Call a session off (or reinstate it) — cancelled sessions leave attendance rates alone' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSessionDto) {
    return this.season.setCancelled(id, dto.cancelled !== false, dto.reason);
  }

  @Post('sessions/:id/register/all-present') @RequirePermissions('attendance.create') @Audit('attendance.all_present', 'session')
  @ApiOperation({ summary: 'Mark everyone not yet marked as present' })
  allPresent(@Param('id', ParseUUIDPipe) id: string) { return this.season.markAllPresent(id); }

  // ---- Sessions / calendar ----
  @Get('sessions') @RequirePermissions('session.view')
  @ApiOperation({ summary: 'Calendar: sessions filtered by date range, team, coach, venue, type' })
  list(@Query() q: any) { return this.sessions.list(q); }

  @Get('sessions/upcoming') @RequirePermissions('session.view')
  @ApiOperation({ summary: 'Sessions in the next N days (dashboard widget)' })
  upcoming(@Query('days') days?: string) { return this.sessions.upcoming(days ? +days : 2); }

  @Get('sessions/:id') @RequirePermissions('session.view')
  findOne(@Param('id') id: string) { return this.sessions.findOne(id); }

  @Post('sessions') @RequirePermissions('session.create') @Audit('session.create', 'session')
  @ApiOperation({ summary: 'Create a session — rejects venue/coach/team double-bookings unless force=true' })
  create(@Body() dto: CreateSessionDto) { return this.sessions.create(dto as any); }

  @Patch('sessions/:id') @RequirePermissions('session.edit') @Audit('session.update', 'session')
  update(@Param('id') id: string, @Body() dto: UpdateSessionDto) { return this.sessions.update(id, dto); }

  @Delete('sessions/:id') @RequirePermissions('session.delete') @Audit('session.delete', 'session')
  remove(@Param('id') id: string) { return this.sessions.remove(id); }

  @Post('sessions/generate') @RequirePermissions('session.create') @Audit('session.generate', 'session')
  @ApiOperation({ summary: 'Bulk-generate recurring sessions across a term (skips conflicts)' })
  generate(@Body() dto: GenerateSessionsDto) { return this.sessions.generateForTerm(dto); }

  // ---- Attendance ----
  @Get('sessions/:id/register') @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Digital register for a session — full roster with existing marks' })
  register(@Param('id') id: string) { return this.attendance.register(id); }

  @Post('sessions/:id/register') @RequirePermissions('attendance.create') @Audit('attendance.mark', 'session')
  @ApiOperation({ summary: 'Submit the register (bulk mark present/absent/excused/late)' })
  mark(@Param('id') id: string, @Body() dto: MarkAttendanceDto) {
    return this.attendance.markBulk(id, dto.marks);
  }

  @Get('attendance/issues') @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Players below an attendance threshold (dashboard alert)' })
  issues(@Query('threshold') threshold?: string) {
    return this.attendance.issues({ threshold: threshold ? +threshold : undefined });
  }

  @Get('attendance/unsubmitted') @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Past sessions whose register was never completed' })
  unsubmitted(@Query('days') days?: string) { return this.attendance.unsubmitted(days ? +days : 7); }

  @Get('players/:id/attendance') @RequirePermissions('attendance.view')
  playerStats(@Param('id') id: string) { return this.attendance.playerStats(id); }

  @Get('teams/:id/attendance') @RequirePermissions('attendance.view')
  teamSummary(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.attendance.teamSummary(id, from, to);
  }
}
