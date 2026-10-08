import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CoachesService } from './coaches.service';
import { SeasonScheduleService } from '../scheduling/season-schedule.service';
import { CreateCoachDto, CreateTeamDto, TransferPlayerDto, UpdateCoachDto, UpdateTeamDto } from './dto/team.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Teams & Coaches')
@Controller()
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly coaches: CoachesService,
    private readonly season: SeasonScheduleService,
  ) {}

  // Teams
  @Get('teams') @RequirePermissions('team.view')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.teams.list(includeInactive === 'true');
  }
  @Get('teams/:id') @RequirePermissions('team.view')
  findOne(@Param('id') id: string) { return this.teams.findOne(id); }
  @Get('teams/:id/roster') @RequirePermissions('team.view')
  @ApiOperation({ summary: 'Team roster with capacity usage' })
  roster(@Param('id') id: string) { return this.teams.roster(id); }
  @Post('teams') @RequirePermissions('team.create') @Audit('team.create', 'team')
  create(@Body() dto: CreateTeamDto) { return this.teams.create(dto); }
  @Patch('teams/:id') @RequirePermissions('team.edit') @Audit('team.update', 'team')
  async update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    const team = await this.teams.update(id, dto);
    // New training days or times: re-plan the team's sessions from today onwards
    // (sessions that already have a register are kept).
    const d: any = dto;
    if (d.trainingDays !== undefined || d.startTime !== undefined || d.endTime !== undefined) {
      try { await this.season.generate({ teamIds: [id], from: new Date().toISOString().slice(0, 10), sync: true }); } catch { /* no season dates yet */ }
    }
    return team;
  }
  @Delete('teams/:id') @RequirePermissions('team.delete') @Audit('team.deactivate', 'team')
  remove(@Param('id') id: string) { return this.teams.remove(id); }
  @Post('teams/transfer') @RequirePermissions('team.edit') @Audit('team.transfer', 'player')
  @ApiOperation({ summary: 'Transfer a player to another team (writes enrolment history)' })
  transfer(@Body() dto: TransferPlayerDto) { return this.teams.transferPlayer(dto); }

  // Coaches
  @Get('coaches') @RequirePermissions('coach.view')
  listCoaches() { return this.coaches.list(); }
  @Get('coaches/:id') @RequirePermissions('coach.view')
  getCoach(@Param('id') id: string) { return this.coaches.findOne(id); }
  @Post('coaches') @RequirePermissions('coach.create') @Audit('coach.create', 'coach')
  @ApiOperation({ summary: 'Create a coach profile for a staff user' })
  createCoach(@Body() dto: CreateCoachDto) { return this.coaches.create(dto); }
  @Patch('coaches/:id') @RequirePermissions('coach.edit') @Audit('coach.update', 'coach')
  @ApiOperation({ summary: 'Full-time / part-time, photo, certification' })
  updateCoach(@Param('id') id: string, @Body() dto: UpdateCoachDto) { return this.coaches.update(id, dto as any); }
}
