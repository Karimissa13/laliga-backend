import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsOptional, IsString, IsUUID,
} from 'class-validator';
import { Gender, LeadSource, LeadStatus } from '../../../database/entities';

// ---- Leads / trials ----
export class ConvertLeadDto {
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender: Gender;
  @ApiProperty({ description: 'Player DOB (required to create the player)' }) @IsDateString() dateOfBirth: string;
  @ApiPropertyOptional({ description: 'Existing guardian to attach to; else one is created from the lead' })
  @IsOptional() @IsUUID() guardianId?: string;
}

// ---- One-flow registration ----
export class RegisterPlayerDto {
  // Guardian: either an existing id, or details to create/find one by email.
  @ApiPropertyOptional() @IsOptional() @IsUUID() guardianId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guardianName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() guardianEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guardianMobile?: string;
  // Player
  @ApiProperty() @IsString() firstName: string;
  @ApiProperty() @IsString() lastName: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender: Gender;
  @ApiProperty() @IsDateString() dateOfBirth: string;
  // Optional immediate enrolment
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
}

export class EnrolDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiProperty() @IsUUID() termId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional({ description: 'Place the child on a team outside their age category, deliberately' })
  @IsOptional() @IsBoolean() allowCategoryOverride?: boolean;
}
export class RenewDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiProperty({ description: 'New term to renew into' }) @IsUUID() termId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
}
