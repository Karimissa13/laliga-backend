import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { DocumentType } from '../../../database/entities';

export class CreateEvaluationDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiPropertyOptional({ example: { technical: 4, tactical: 3, physical: 4, social: 5 }, description: 'Scores 1–5' })
  @IsOptional() @IsObject() scores?: Record<string, number>;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class RegisterDocumentDto {
  @ApiProperty({ enum: DocumentType }) @IsEnum(DocumentType) type: DocumentType;
  @ApiProperty() @IsString() fileName: string;
  @ApiProperty({ description: 'Object-storage key' }) @IsString() storageKey: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mimeType?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sizeBytes?: number;
  @ApiPropertyOptional({ description: 'Expiry (insurance, Emirates ID)' }) @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() playerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() guardianId?: string;
}

// ---- term reports (Development / Advanced) ----
import { ArrayMaxSize as _AMS, IsArray as _IA, IsIn as _IIn, Max as _Max, MaxLength as _ML, Min as _Min, ValidateIf as _VI } from 'class-validator';
import { Transform as _T } from 'class-transformer';

export class ReportBoardDto {
  @ApiPropertyOptional({ description: 'Defaults to the term in progress' }) @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coachId?: string;
  @ApiPropertyOptional({ enum: ['TODO', 'DRAFT', 'FINAL', 'SENT'] }) @IsOptional() @_IIn(['TODO', 'DRAFT', 'FINAL', 'SENT']) status?: string;
  @ApiPropertyOptional({ enum: ['DEVELOPMENT', 'ADVANCED'] }) @IsOptional() @_IIn(['DEVELOPMENT', 'ADVANCED']) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @_ML(80) search?: string;
}
export class SaveReportDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() playerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional({ enum: ['DEVELOPMENT', 'ADVANCED'], description: 'Defaults from the team: Development squads → DEVELOPMENT, Advanced/HPC → ADVANCED' })
  @IsOptional() @_IIn(['DEVELOPMENT', 'ADVANCED']) reportType?: 'DEVELOPMENT' | 'ADVANCED';
  @ApiPropertyOptional() @IsOptional() @_VI((o) => o.coachId !== null) @IsUUID() coachId?: string | null;
  @ApiPropertyOptional({ example: { 'technical.ball_skills': 4 }, description: 'Item scores keyed "area.item"' }) @IsOptional() @IsObject() scores?: Record<string, number>;
  @ApiPropertyOptional({ description: 'Development: observations. Advanced: general comment.' }) @IsOptional() @_VI((o) => o.notes !== null) @IsString() @_ML(4000) notes?: string | null;
  @ApiPropertyOptional({ description: 'Advanced: a comment per area' }) @IsOptional() @IsObject() comments?: Record<string, string>;
  @ApiPropertyOptional({ example: ['CM1', 'RW'] }) @IsOptional() @_IA() @_AMS(2) @IsString({ each: true }) positions?: string[];
  @ApiPropertyOptional({ enum: ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'] }) @IsOptional() @_IIn(['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD']) position?: string;
  @ApiPropertyOptional() @IsOptional() @_VI((o) => o.shirtNumber !== null) @IsInt() @_Min(1) @_Max(99) shirtNumber?: number | null;
  @ApiPropertyOptional({ description: 'Advanced: small JPEG/PNG data URL; null removes it' }) @IsOptional() @_VI((o) => o.photo !== null) @IsString() @_ML(400000) photo?: string | null;
}
