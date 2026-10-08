import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';

export class CreateGuardianDto {
  @ApiProperty() @IsString() fullName: string;
  @ApiPropertyOptional({ example: 'Father' }) @IsOptional() @IsString() relationship?: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() secondaryEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) secondaryEmailName?: string;
  @ApiProperty({ example: '+9715XXXXXXXX' }) @IsString() mobile: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emirate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @ApiPropertyOptional({ description: 'Optional parent-portal password' })
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

export class UpdateGuardianDto {
  @ApiPropertyOptional() @IsOptional() @IsString() fullName?: string;
  @ApiPropertyOptional({ description: 'Must not belong to another parent' }) @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() relationship?: string;
  @ApiPropertyOptional({ description: 'Another family member\'s email; empty or null removes it' })
  @IsOptional() @ValidateIf((o) => o.secondaryEmail !== null && o.secondaryEmail !== '') @IsEmail() secondaryEmail?: string | null;
  @ApiPropertyOptional({ example: 'Mother — Rana' }) @IsOptional() @ValidateIf((o) => o.secondaryEmailName !== null) @IsString() @MaxLength(120) secondaryEmailName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emirate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(8) password?: string;
}

export class GuardianDirectoryDto {
  @ApiPropertyOptional({ description: 'Name, email (main or additional), mobile, child\'s name' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ example: 'PR-000012 or 12' }) @IsOptional() @IsString() @MaxLength(20) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) emirate?: string;
  @ApiPropertyOptional({ enum: ['active', 'none'] }) @IsOptional() @IsIn(['active', 'none']) children?: 'active' | 'none';
  @ApiPropertyOptional({ enum: ['signed_in', 'sent', 'never'] }) @IsOptional() @IsIn(['signed_in', 'sent', 'never']) portal?: string;
  @ApiPropertyOptional({ enum: ['yes', 'no'] }) @IsOptional() @IsIn(['yes', 'no']) additionalEmail?: 'yes' | 'no';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
