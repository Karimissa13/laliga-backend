import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { boolParam } from '../../common/query-params';
import { SquadMoveService } from './squad-move.service';

export class MoveQuoteQueryDto {
  @ApiProperty() @IsUUID() toTeamId: string;
  @ApiPropertyOptional({ example: '2026-10-13', description: 'First day in the new team; today when omitted' })
  @IsOptional() @IsDateString() moveDate?: string;
}

export class MoveDto extends MoveQuoteQueryDto {
  @ApiPropertyOptional({ default: true, description: 'Issue (and auto-email) the move-up invoice now' })
  @IsOptional() @Transform(boolParam) @IsBoolean() issue?: boolean;
  @ApiPropertyOptional({ enum: ['split', 'one'], default: 'split', description: 'On an instalment plan: split over its remaining dates, or one payment' })
  @IsOptional() @IsIn(['split', 'one']) instalments?: 'split' | 'one';
  @ApiPropertyOptional({ default: false, description: 'Moving to fewer sessions: credit the prorated difference (with a credit note)' })
  @IsOptional() @Transform(boolParam) @IsBoolean() credit?: boolean;
  @ApiPropertyOptional({ example: 'Coaches moved him up after the October assessment' })
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

const can = (u: AuthUser | undefined, p: string) => !!u?.permissions && (u.permissions.includes('*') || u.permissions.includes(p));

@ApiTags('Player desk — squad moves')
@Controller('players/:id/move')
export class SquadMoveController {
  constructor(private readonly moves: SquadMoveService) {}

  @Get('quote') @RequirePermissions('player.view', 'invoice.view')
  @ApiOperation({ summary: 'What moving a child to another team would cost or credit — nothing is saved' })
  quote(@Param('id', ParseUUIDPipe) id: string, @Query() q: MoveQuoteQueryDto) {
    return this.moves.quote(id, q);
  }

  @Post() @RequirePermissions('team.edit', 'invoice.create') @Audit('player.move', 'player')
  @ApiOperation({ summary: 'Move a child to another team: history kept, move-up invoiced on its own linked invoice, move down optionally credited' })
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDto, @CurrentUser() u: AuthUser) {
    if (dto.credit && !(can(u, 'writeoff.create') && can(u, 'refund.create'))) {
      throw new ForbiddenException('Crediting a move needs the write-off and refund permissions.');
    }
    return this.moves.apply(id, dto, u?.id);
  }
}
