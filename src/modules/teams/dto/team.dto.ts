import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { CoachEmployment } from '../../../database/entities';

export class CreateTeamDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() headCoachId?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @IsInt() @Min(1) capacity?: number;
}
export class UpdateTeamDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() headCoachId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class TransferPlayerDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiProperty({ description: 'Destination team' }) @IsUUID() toTeamId: string;
  @ApiPropertyOptional({ description: 'Season for the enrolment record (defaults to active season)' })
  @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
}
export class CreateCoachDto {
  @ApiProperty({ description: 'Existing staff user id to make a coach' }) @IsUUID() userId: string;
  @ApiPropertyOptional({ example: 'UEFA A Pro' }) @IsOptional() @IsString() certification?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bio?: string;
}

export class UpdateCoachDto {
  @ApiPropertyOptional({ enum: CoachEmployment, nullable: true }) @IsOptional() @IsEnum(CoachEmployment) employmentType?: CoachEmployment | null;
  @ApiPropertyOptional({ description: 'data:image/… URL, up to ~300 KB' })
  @IsOptional() @IsString() @Matches(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, { message: 'photoUrl must be a PNG, JPEG or WebP data URL' })
  @MaxLength(400000) photoUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() certification?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bio?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
