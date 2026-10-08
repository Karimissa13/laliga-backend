import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender, PlayerStatus, TeamLevel } from '../../../database/entities';
import { PaymentState } from '../../finance/payment-state';

export class CreatePlayerDto {
  @ApiPropertyOptional({ default: true, description: 'Email the parent the welcome. Siblings registered together pass false for all but the last child, so the family gets one email.' })
  @IsOptional() @IsBoolean() sendWelcome?: boolean;
  @ApiProperty() @IsUUID() guardianId: string;
  @ApiProperty() @IsString() firstName: string;
  @ApiProperty() @IsString() lastName: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender: Gender;
  @ApiProperty({ example: '2016-04-12' }) @IsDateString() dateOfBirth: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() kitSize?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() previousAcademy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() medicalNotes?: string;
  @ApiPropertyOptional({ enum: PlayerStatus }) @IsOptional() @IsEnum(PlayerStatus) status?: PlayerStatus;
  @ApiPropertyOptional({ enum: TeamLevel }) @IsOptional() @IsEnum(TeamLevel) level?: TeamLevel;
  @ApiPropertyOptional({ description: 'Manual category when date of birth cannot place the child' })
  @IsOptional() @IsUUID() ageGroupId?: string;
}

export class UpdatePlayerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() kitSize?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() previousAcademy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() medicalNotes?: string;
  @ApiPropertyOptional({ description: 'Manual category; send null to return to the date-of-birth category', nullable: true })
  @IsOptional() @IsUUID() ageGroupId?: string | null;
  @ApiPropertyOptional({ enum: TeamLevel }) @IsOptional() @IsEnum(TeamLevel) level?: TeamLevel;
}

export class SetPlayerStatusDto {
  @ApiProperty({ enum: PlayerStatus }) @IsEnum(PlayerStatus) status: PlayerStatus;
}

export class AddCommentDto {
  @ApiProperty({ example: 'Parent asked to move to Mon/Wed/Fri' })
  @IsString() @MinLength(2) @MaxLength(2000) body: string;
}

import { PaginationDto } from '../../../common/dto/pagination.dto';

export class PlayerFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Child or parent name, parent email, or phone number (spaces and +971 ignored)' })
  @IsOptional() @IsString() declare search?: string;
  @ApiPropertyOptional({ example: 'PL-000012', description: '"PL-12" and "12" also match' })
  @IsOptional() @IsString() playerRef?: string;
  @ApiPropertyOptional({ example: 'PR-000004' })
  @IsOptional() @IsString() guardianRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiPropertyOptional({ enum: [...Object.values(PaymentState), 'OVERDUE'] })
  @IsOptional() @IsIn([...Object.values(PaymentState), 'OVERDUE']) paymentStatus?: PaymentState | 'OVERDUE';
  @ApiPropertyOptional({ example: '2026-08-01', description: 'Registered on or after' })
  @IsOptional() @IsDateString() registeredFrom?: string;
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Registered on or before' })
  @IsOptional() @IsDateString() registeredTo?: string;
  @ApiPropertyOptional({ enum: PlayerStatus }) @IsOptional() @IsEnum(PlayerStatus) status?: PlayerStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() guardianId?: string;
  @ApiPropertyOptional({ description: 'Include archived children' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeArchived?: boolean;
}
