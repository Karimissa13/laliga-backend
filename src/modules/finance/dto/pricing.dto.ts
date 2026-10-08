import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { KitType, RevenueStream, TeamLevel } from '../../../database/entities';

export class UpdatePriceEntryDto {
  @ApiPropertyOptional({ example: { T1: 5610, T2: 3366, T3: 2618, T1_2: 6732, T2_3: 5387, FULL: 9350 },
    description: 'VAT-inclusive prices by term option; null removes an option' })
  @IsOptional() @IsObject() prices?: Record<string, number | null>;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sessionRate?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class KitItemDto {
  @ApiProperty({ enum: KitType }) @IsEnum(KitType) type: KitType;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(10) qty: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'KIT-HOME' }) @IsString() @MinLength(2) @MaxLength(40) code: string;
  @ApiProperty({ example: 'Home kit' }) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ enum: RevenueStream }) @IsEnum(RevenueStream) stream: RevenueStream;
  @ApiProperty({ example: 350, description: 'VAT-inclusive' }) @IsNumber() @Min(0.01) priceInclVat: number;
  @ApiPropertyOptional({ default: 5 }) @IsOptional() @IsNumber() @Min(0) @Max(100) vatRate?: number;
  @ApiPropertyOptional({ enum: TeamLevel, isArray: true }) @IsOptional() @IsArray() @IsEnum(TeamLevel, { each: true }) levels?: TeamLevel[];
  @ApiPropertyOptional({ type: [KitItemDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => KitItemDto) kitItems?: KitItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offerAtRegistration?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ enum: RevenueStream }) @IsOptional() @IsEnum(RevenueStream) stream?: RevenueStream;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.01) priceInclVat?: number;
  @ApiPropertyOptional({ enum: TeamLevel, isArray: true }) @IsOptional() @IsArray() @IsEnum(TeamLevel, { each: true }) levels?: TeamLevel[];
  @ApiPropertyOptional({ type: [KitItemDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => KitItemDto) kitItems?: KitItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offerAtRegistration?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

/** One extra on an invoice: a catalogue product, or a custom charge. */
export class ExtraItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() playerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(20) quantity?: number;
  @ApiPropertyOptional({ example: 'Extra training top' }) @IsOptional() @IsString() @MinLength(2) @MaxLength(160) description?: string;
  @ApiPropertyOptional({ example: 150, description: 'VAT-inclusive, custom items only' }) @IsOptional() @IsNumber() @Min(0.01) amountInclVat?: number;
  @ApiPropertyOptional({ enum: RevenueStream }) @IsOptional() @IsEnum(RevenueStream) stream?: RevenueStream;
}
