import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FinanceReportsService } from '../finance/finance-reports.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlayersService } from './players.service';
import { PlayerDirectoryService } from './player-directory.service';
import {
  AddCommentDto, CreatePlayerDto, PlayerFilterDto, SetPlayerStatusDto, UpdatePlayerDto,
} from './dto/player.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { seesMoney } from '../../common/money-visibility';

@ApiTags('Players')
@Controller('players')
export class PlayersController {
  constructor(
    private readonly players: PlayersService,
    private readonly directory: PlayerDirectoryService,
  ) {}

  @Get()
  @RequirePermissions('player.view')
  @ApiOperation({ summary: 'Player directory: name/phone, PL-, PR-, location, category, season, term, team, coach, payment status, registration dates' })
  async list(@Query() q: PlayerFilterDto, @CurrentUser() u: AuthUser) {
    if (!seesMoney(u)) delete (q as any).paymentStatus;
    const r: any = await this.directory.list({ ...q, page: q.page, limit: q.limit } as any);
    // Coaches see the children, not what the family owes.
    if (!seesMoney(u)) r.data = r.data.map((x: any) => ({ ...x, payment: null }));
    return r;
  }

  /** The player list with the same filters, as an Excel (CSV) file — every matching child, not just one page. */
  @Get('export.csv')
  @RequirePermissions('player.view') @Audit('player.export', 'player')
  @ApiOperation({ summary: 'Export the player list (same filters as the screen) as CSV' })
  async exportCsv(@Query() q: PlayerFilterDto, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const money = seesMoney(u);
    if (!money) delete (q as any).paymentStatus;
    const r: any = await this.directory.list({ ...q, page: 1, limit: 10000 } as any);
    const dmy = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
    const csv = FinanceReportsService.toCsv(
      ['Player No', 'Player Name', 'Date of Birth', 'Gender', 'Category', 'Level', 'Team', 'Training Days', 'Coach', 'Term Option', 'Season',
        'Location', 'Parent No', 'Parent Name', 'Parent Email', 'Parent Mobile', ...(money ? ['Payment Status', 'Invoice No', 'Balance (AED)'] : []),
        'Registered', 'Archived', 'Latest Comment'],
      r.data.map((x: any) => [x.reference, x.name, dmy(x.dateOfBirth), x.gender === 'FEMALE' ? 'Female' : 'Male', x.category ?? '', x.level ?? '',
        x.team?.name ?? '', x.days ?? '', x.coach?.name ?? '', x.term?.name ?? '', x.term?.season ?? '',
        x.location ?? '', x.guardianReference, x.guardianName, x.guardianEmail, x.guardianMobile,
        ...(money ? [x.payment?.label ?? '', x.payment?.invoiceNumber ?? '', x.payment?.balance == null ? '' : Number(x.payment.balance).toFixed(2)] : []),
        dmy(x.registeredAt), x.archived ? 'Yes' : 'No', x.latestComment?.body ?? '']));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Players.csv"');
    res.send(csv);
  }

  // Before ':id', so "birth-date-range" is never read as a player id.
  @Get('birth-date-range')
  @ApiOperation({ summary: 'Dates of birth the academy takes this season (U6 to U18) — limits the date pickers' })
  birthDateRange() { return this.players.birthDateRange(); }

  @Get(':id')
  @RequirePermissions('player.view')
  findOne(@Param('id') id: string) { return this.players.findOne(id); }

  @Get(':id/history')
  @RequirePermissions('player.view')
  @ApiOperation({ summary: 'Enrolment history (season/term/team) — preserved across changes' })
  history(@Param('id') id: string) { return this.players.history(id); }

  @Post()
  @RequirePermissions('player.create')
  @Audit('player.create', 'player')
  @ApiOperation({ summary: 'Create a player (age group auto-derived from DOB)' })
  create(@Body() dto: CreatePlayerDto, @CurrentUser() u: AuthUser) {
    const { sendWelcome, ...input } = dto;
    return this.players.create(input as any, { notify: sendWelcome !== false, actorId: u?.id });
  }

  @Patch(':id')
  @RequirePermissions('player.edit')
  @Audit('player.update', 'player')
  update(@Param('id') id: string, @Body() dto: UpdatePlayerDto) {
    return this.players.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('player.edit')
  @Audit('player.status', 'player')
  setStatus(@Param('id') id: string, @Body() dto: SetPlayerStatusDto) {
    return this.players.setStatus(id, dto.status);
  }

  @Post(':id/comments')
  @RequirePermissions('player.edit')
  @ApiOperation({ summary: 'Add an admin/coach comment to a player' })
  addComment(@Param('id') id: string, @Body() dto: AddCommentDto, @CurrentUser() user: AuthUser) {
    return this.players.addComment(id, dto.body, user.id);
  }

  @Delete(':id')
  @RequirePermissions('player.delete')
  @Audit('player.withdraw', 'player')
  @ApiOperation({ summary: 'Withdraw a player (soft, preserves history)' })
  remove(@Param('id') id: string) { return this.players.remove(id); }
}
