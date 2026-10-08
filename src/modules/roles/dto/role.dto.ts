import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ type: [String], example: ['player.view', 'invoice.view'] })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true })
  permissionKeys: string[];
}

export class UpdateRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true })
  permissionKeys: string[];
}
