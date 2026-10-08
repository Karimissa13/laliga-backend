import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsUUID, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationChannel, PlayerStatus } from '../../../database/entities';

export class CreateTemplateDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: CommunicationChannel }) @IsEnum(CommunicationChannel) channel: CommunicationChannel;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiProperty({ description: 'Supports {{guardian.fullName}} style variables' }) @IsString() body: string;
}
export class UpdateTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AudienceDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) guardianIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional({ enum: PlayerStatus }) @IsOptional() @IsEnum(PlayerStatus) playerStatus?: PlayerStatus;
  @ApiPropertyOptional({ description: 'Only guardians with an outstanding balance' })
  @IsOptional() @IsBoolean() hasOutstanding?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() all?: boolean;
}

export class BroadcastDto {
  @ApiProperty({ type: AudienceDto })
  @IsObject() @ValidateNested() @Type(() => AudienceDto)
  audience: AudienceDto;
  @ApiProperty({ enum: CommunicationChannel }) @IsEnum(CommunicationChannel) channel: CommunicationChannel;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional({ description: 'Use a saved template instead of inline body' })
  @IsOptional() @IsString() templateName?: string;
}

export class RunAutomationDto {
  @ApiPropertyOptional({ default: true, description: 'Preview without sending' })
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @ApiPropertyOptional({ enum: CommunicationChannel }) @IsOptional() @IsEnum(CommunicationChannel) channel?: CommunicationChannel;
}

export class SetScheduleEnabledDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}
export class SetCronDto {
  @ApiProperty({ example: '0 9 * * *', description: '5-field cron, evaluated in Asia/Dubai' })
  @IsString() cron: string;
}
