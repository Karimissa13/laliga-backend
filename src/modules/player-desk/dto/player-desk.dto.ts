import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString,
  IsIn, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { MANUAL_PRESET_CODES } from '../../finance/manual-discounts';
import { TeamLevel, TermPackage } from '../../../database/entities';
import { ExtraItemDto } from '../../finance/dto/pricing.dto';
import { InstalmentItemDto } from '../../finance/dto/finance.dto';
// Query strings carry lists as "a,b,c" (listParam) and numbers as text (numParam).
import { listParam, numParam } from '../../../common/query-params';

export class ManualDiscountDto {
  @ApiPropertyOptional({ enum: MANUAL_PRESET_CODES, description: 'Percentage off the training fee: early bird 10%, 10%, 15%, 25%, 50% or sponsored 100%' })
  @IsOptional() @IsIn(MANUAL_PRESET_CODES) preset?: string;
  @ApiPropertyOptional({ example: 12.5, description: 'Any percentage off the training fee (0.01–100), instead of a preset' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) percent?: number;
  @ApiPropertyOptional({ example: 300, description: 'Older way: a fixed AED amount (excl. VAT) instead of a preset' })
  @ValidateIf((o) => !o.preset && o.percent == null) @IsNumber() @Min(0.01) amount?: number;
  @ApiPropertyOptional({ example: 'Goodwill — coach promise' }) @ValidateIf((o) => !o.preset && o.percent == null) @IsString() @MinLength(2) label?: string;
  @ApiPropertyOptional({ example: 'Approved by Karim' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class AddTermDto {
  @ApiPropertyOptional({ description: 'One term (the older way of asking). Use `package` for the six term options.' })
  @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional({ enum: TermPackage, description: 'Term 1, Term 2, Term 3, Terms 1 & 2, Terms 2 & 3 or Full season' })
  @IsOptional() @IsEnum(TermPackage) package?: TermPackage;
  @ApiPropertyOptional({ description: 'Sessions a week being bought (1, 2 or 3). Defaults to the team\'s schedule.' })
  @IsOptional() @IsInt() @Min(1) @Max(3) sessionsPerWeek?: number;
  @ApiPropertyOptional({ description: 'Optional extras from the catalogue: kits, Man City League' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('4', { each: true }) productIds?: string[];
  @ApiPropertyOptional({ description: 'Team for this term; omit to keep the current team' })
  @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional({ description: 'Place outside the child\'s age category, deliberately' })
  @IsOptional() @IsBoolean() allowCategoryOverride?: boolean;
  @ApiPropertyOptional({ description: 'Replaces the automatic sibling discount for this child — never added on top' })
  @IsOptional() @ValidateNested() @Type(() => ManualDiscountDto) manualDiscount?: ManualDiscountDto;
  @ApiPropertyOptional({ example: '2026-10-12', description: 'First training day, when after the term starts — the training fee is prorated by sessions left' })
  @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ type: [InstalmentItemDto], description: 'Pay in 2–5 instalments: each % of the invoice total and its due date (set by the academy)' })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InstalmentItemDto) instalments?: InstalmentItemDto[];
  @ApiPropertyOptional({ default: true, description: 'Issue the invoice straight away (false keeps it as a draft)' })
  @IsOptional() @IsBoolean() issue?: boolean;
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @IsNumber() dueInDays?: number;
}

export class ReasonDto {
  @ApiProperty({ example: 'Family relocated to Dubai', description: 'Recorded in the activity log' })
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

export class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class PlacementQueryDto {
  @ApiProperty({ example: '2015-03-14' }) @IsDateString() dob: string;
}

export class EligibleTeamsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional({ enum: TeamLevel }) @IsOptional() @IsEnum(TeamLevel) level?: TeamLevel;
  @ApiPropertyOptional() @IsOptional() @IsUUID() seasonId?: string;
}

export class GuardianLookupDto {
  @ApiProperty({ description: 'Phone, email or PR- number' }) @IsString() @MinLength(3) q: string;
}

export class QuoteQueryDto {
  @ApiPropertyOptional({ description: 'Any percentage off the training fee instead of a preset' }) @IsOptional() @Transform(numParam) @IsNumber() @Min(0.01) @Max(100) manualPercent?: number;
  @ApiPropertyOptional({ example: '2026-10-12', description: 'First training day, when after the term starts — the training fee is prorated by sessions left' })
  @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ enum: MANUAL_PRESET_CODES, description: 'Price with a manual discount instead of the sibling discount' }) @IsOptional() @IsIn(MANUAL_PRESET_CODES) manualPreset?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional({ enum: TermPackage }) @IsOptional() @IsEnum(TermPackage) package?: TermPackage;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(numParam) @IsInt() @Min(1) @Max(3) sessionsPerWeek?: number;
  @ApiPropertyOptional({ description: 'Comma-separated product ids' }) @IsOptional() @Transform(listParam) @IsArray() @IsUUID('4', { each: true }) productIds?: string[];
}

export class RegistrationOptionsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional({ enum: TeamLevel }) @IsOptional() @IsEnum(TeamLevel) level?: TeamLevel;
}

export class AddItemsDto {
  @ApiProperty({ type: [ExtraItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => ExtraItemDto) items: ExtraItemDto[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() issue?: boolean;
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @IsNumber() dueInDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class AssignCoachDto {
  @ApiPropertyOptional({ description: 'Coach id; null removes the coach' })
  @IsOptional() @IsUUID() coachId?: string | null;
}

export class NewChildQuoteDto {
  @ApiPropertyOptional({ description: 'Any percentage off the training fee instead of a preset' }) @IsOptional() @Transform(numParam) @IsNumber() @Min(0.01) @Max(100) manualPercent?: number;
  @ApiPropertyOptional({ example: '2026-10-12', description: 'First training day, when after the term starts — the training fee is prorated by sessions left' })
  @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ enum: MANUAL_PRESET_CODES, description: 'Price with a manual discount instead of the sibling discount' }) @IsOptional() @IsIn(MANUAL_PRESET_CODES) manualPreset?: string;
  @ApiPropertyOptional({ description: 'Existing parent; omit for a new family' }) @IsOptional() @IsUUID() guardianId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiProperty({ example: '2019-04-02' }) @IsDateString() dob: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional({ enum: TermPackage }) @IsOptional() @IsEnum(TermPackage) package?: TermPackage;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(numParam) @IsInt() @Min(1) @Max(3) sessionsPerWeek?: number;
  @ApiPropertyOptional({ description: 'Comma-separated product ids' }) @IsOptional() @Transform(listParam) @IsArray() @IsUUID('4', { each: true }) productIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;
}

/** One child's purchase on a family invoice (siblings registered together). */
export class FamilyTermItemDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiPropertyOptional({ enum: TermPackage }) @IsOptional() @IsEnum(TermPackage) package?: TermPackage;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3) sessionsPerWeek?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('4', { each: true }) productIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowCategoryOverride?: boolean;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => ManualDiscountDto) manualDiscount?: ManualDiscountDto;
  @ApiPropertyOptional({ example: '2026-10-12', description: 'First training day, when after the term starts — the training fee is prorated by sessions left' })
  @IsOptional() @IsDateString() startDate?: string;
}
export class FamilyTermsDto {
  @ApiPropertyOptional({ type: [InstalmentItemDto], description: 'Pay in 2–5 instalments: each % of the invoice total and its due date (set by the academy)' })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InstalmentItemDto) instalments?: InstalmentItemDto[];
  @ApiProperty({ type: [FamilyTermItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => FamilyTermItemDto) items: FamilyTermItemDto[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() issue?: boolean;
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @IsNumber() dueInDays?: number;
}
export class FamilyQuoteChildDto {
  @ApiProperty({ description: 'Any key the screen uses for this child' }) @IsString() @MaxLength(40) key: string;
  @ApiPropertyOptional({ description: 'A child already on file' }) @IsOptional() @IsUUID() playerId?: string;
  @ApiPropertyOptional({ example: '2016-04-02' }) @IsOptional() @IsDateString() dob?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional({ enum: TermPackage }) @IsOptional() @IsEnum(TermPackage) package?: TermPackage;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3) sessionsPerWeek?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('4', { each: true }) productIds?: string[];
  @ApiPropertyOptional({ enum: MANUAL_PRESET_CODES }) @IsOptional() @IsIn(MANUAL_PRESET_CODES) manualPreset?: string;
  @ApiPropertyOptional({ description: 'Any percentage off the training fee instead of a preset' }) @IsOptional() @IsNumber() @Min(0.01) @Max(100) manualPercent?: number;
  @ApiPropertyOptional({ example: '2026-10-12', description: 'First training day, when after the term starts — the training fee is prorated by sessions left' })
  @IsOptional() @IsDateString() startDate?: string;
}
export class FamilyQuoteDto {
  @ApiPropertyOptional({ description: 'Existing parent; omit for a new family' }) @IsOptional() @IsUUID() guardianId?: string;
  @ApiProperty({ type: [FamilyQuoteChildDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => FamilyQuoteChildDto) children: FamilyQuoteChildDto[];
}
