import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional,
  IsString, IsUUID, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus, SessionType } from '../../../database/entities';

export class CreateSessionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional({ enum: SessionType }) @IsOptional() @IsEnum(SessionType) type?: SessionType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() venueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiProperty({ example: '2026-09-01T18:00:00Z' }) @IsDateString() startsAt: string;
  @ApiProperty({ example: '2026-09-01T19:30:00Z' }) @IsDateString() endsAt: string;
  @ApiPropertyOptional({ description: 'Book anyway despite conflicts' })
  @IsOptional() @IsBoolean() force?: boolean;
}

export class UpdateSessionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional({ enum: SessionType }) @IsOptional() @IsEnum(SessionType) type?: SessionType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() venueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() force?: boolean;
}

export class GenerateSessionsDto {
  @ApiProperty() @IsUUID() termId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() venueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiProperty({ example: [1, 3, 5], description: '0=Sun … 6=Sat' })
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  weekdays: number[];
  @ApiProperty({ example: '18:00' }) @Matches(/^\d{2}:\d{2}$/) startTime: string;
  @ApiProperty({ example: '19:30' }) @Matches(/^\d{2}:\d{2}$/) endTime: string;
  @ApiPropertyOptional({ enum: SessionType }) @IsOptional() @IsEnum(SessionType) type?: SessionType;
}

export class AttendanceMarkDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiProperty({ enum: AttendanceStatus }) @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;
}
export class MarkAttendanceDto {
  @ApiProperty({ type: [AttendanceMarkDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => AttendanceMarkDto)
  marks: AttendanceMarkDto[];
}
