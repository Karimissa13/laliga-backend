import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AcademyEventKind } from '../../database/entities';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AcademyCalendarService } from './academy-calendar.service';

export class AcademyEventDto {
  @ApiProperty({ enum: AcademyEventKind }) @IsEnum(AcademyEventKind) kind: AcademyEventKind;
  @ApiProperty({ example: 'Abu Dhabi Cup' }) @IsString() @MinLength(2) @MaxLength(160) title: string;
  @ApiProperty({ example: '2027-01-16' }) @IsDateString() startDate: string;
  @ApiPropertyOptional({ example: '2027-01-17' }) @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateAcademyEventDto {
  @ApiPropertyOptional({ enum: AcademyEventKind }) @IsOptional() @IsEnum(AcademyEventKind) kind?: AcademyEventKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class AcademyEventQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: AcademyEventKind }) @IsOptional() @IsEnum(AcademyEventKind) kind?: AcademyEventKind;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
}

@ApiTags('Academy calendar')
@Controller('academy-events')
export class AcademyCalendarController {
  constructor(private readonly cal: AcademyCalendarService) {}

  @Get() @RequirePermissions('session.view')
  @ApiOperation({ summary: 'Pitch bookings, matches, tournaments and holidays' })
  list(@Query() q: AcademyEventQueryDto) { return this.cal.list(q); }

  @Post() @RequirePermissions('session.create') @Audit('calendar.create', 'academy_event')
  create(@Body() dto: AcademyEventDto) { return this.cal.create(dto); }

  @Patch(':id') @RequirePermissions('session.edit') @Audit('calendar.update', 'academy_event')
  update(@Param('id') id: string, @Body() dto: UpdateAcademyEventDto) { return this.cal.update(id, dto); }

  @Delete(':id') @RequirePermissions('session.delete') @Audit('calendar.delete', 'academy_event')
  remove(@Param('id') id: string) { return this.cal.remove(id); }
}
