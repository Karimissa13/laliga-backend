import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min,
} from 'class-validator';
import { ProgramType } from '../../../database/entities';

export class CreateSeasonDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ description: 'Age-group birth-year cutoff for this season' })
  @IsOptional() @IsDateString() cutoffDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSeasonDto extends CreateSeasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name: string;
}

export class CreateTermDto {
  @ApiProperty() @IsUUID() seasonId: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional({ enum: ProgramType }) @IsOptional() @IsEnum(ProgramType) type?: ProgramType;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) weeks?: number;
}
export class UpdateTermDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: ProgramType }) @IsOptional() @IsEnum(ProgramType) type?: ProgramType;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) weeks?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateLocationDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emirate?: string;
}
export class UpdateLocationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emirate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateVenueDto {
  @ApiProperty() @IsUUID() locationId: string;
  @ApiProperty() @IsString() name: string;
}

export class CreateAgeGroupDto {
  @ApiProperty({ example: 'U12' }) @IsString() code: string;
  @ApiProperty({ example: 'U-12' }) @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() minBirthYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxBirthYear?: number;
}
export class UpdateAgeGroupDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
