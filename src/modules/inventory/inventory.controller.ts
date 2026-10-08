import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { InventoryProgramme, StockMovementType } from '../../database/entities';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { FinanceReportsService } from '../finance/finance-reports.service';
import { InventoryService } from './inventory.service';

const bool = ({ value }: { value: any }) => (value === undefined || value === '' ? undefined : value === true || value === 'true');

class SizeDto {
  @ApiPropertyOptional({ example: 'M' }) @IsOptional() @IsString() @MaxLength(20) size?: string;
  @ApiPropertyOptional({ example: 20 }) @IsOptional() @IsInt() @Min(0) @Max(100000) openingQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minLevel?: number;
}
export class CreateItemDto {
  @ApiProperty({ example: 'Puma Red Training Top' }) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty({ enum: InventoryProgramme }) @IsEnum(InventoryProgramme) programme: InventoryProgramme;
  @ApiProperty({ example: 'T-shirts' }) @IsString() @MinLength(2) @MaxLength(60) category: string;
  @ApiPropertyOptional({ description: 'Group code shared by all sizes; generated if omitted' }) @IsOptional() @IsString() @MaxLength(60) itemCode?: string;
  @ApiPropertyOptional({ example: 'Pcs' }) @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional({ example: 'New' }) @IsOptional() @IsString() @MaxLength(30) condition?: string;
  @ApiPropertyOptional({ example: 'Box 7' }) @IsOptional() @IsString() @MaxLength(80) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minLevel?: number;
  @ApiProperty({ type: [SizeDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SizeDto) sizes: SizeDto[];
}
export class UpdateItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) condition?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minLevel?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class MoveLineDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() itemId?: string;
  @ApiPropertyOptional({ example: 'LL-004-M' }) @IsOptional() @IsString() @MaxLength(40) sku?: string;
  @ApiPropertyOptional({ example: 5 }) @IsOptional() @IsInt() @Min(1) @Max(100000) quantity: number;
  @ApiPropertyOptional({ description: 'Stock take: the quantity counted on the shelf' }) @IsOptional() @IsInt() @Min(0) countedQty?: number;
}
export class MoveDto {
  @ApiProperty({ enum: ['IN', 'OUT', 'ADJUST'] }) @IsIn(['IN', 'OUT', 'ADJUST']) type: StockMovementType;
  @ApiPropertyOptional({ example: '2026-10-07' }) @IsOptional() @IsDateString() movedOn?: string;
  @ApiPropertyOptional({ example: 'Coach Pol — U12 HPC', description: 'Given to / received from' }) @IsOptional() @IsString() @MaxLength(120) party?: string;
  @ApiPropertyOptional({ example: 'Match kits for Abu Dhabi Cup' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @ApiPropertyOptional({ example: 'DN-4471' }) @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() playerId?: string;
  @ApiProperty({ type: [MoveLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => MoveLineDto) lines: MoveLineDto[];
}
export class ResetInventoryDto {
  @ApiProperty({ example: 'CLEAR INVENTORY' }) @IsString() confirm: string;
}
export class ItemQueryDto {
  @ApiPropertyOptional({ enum: InventoryProgramme }) @IsOptional() @IsEnum(InventoryProgramme) programme?: InventoryProgramme;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional({ enum: ['OK', 'LOW', 'OUT'] }) @IsOptional() @IsIn(['OK', 'LOW', 'OUT']) status?: 'OK' | 'LOW' | 'OUT';
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() includeInactive?: boolean;
}
export class MovementQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: StockMovementType }) @IsOptional() @IsEnum(StockMovementType) type?: StockMovementType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() itemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional({ enum: InventoryProgramme }) @IsOptional() @IsEnum(InventoryProgramme) programme?: InventoryProgramme;
  @ApiPropertyOptional({ default: 300 }) @IsOptional() @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value))) @IsInt() @Min(1) @Max(2000) limit?: number;
}

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Get('items') @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Stock by SKU (item + size), with low / out-of-stock flags' })
  list(@Query() q: ItemQueryDto) { return this.inv.list(q); }

  @Get('summary') @RequirePermissions('inventory.view')
  summary(@Query('programme') programme?: InventoryProgramme) { return this.inv.summary(programme); }

  @Get('items/:id') @RequirePermissions('inventory.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.inv.get(id); }

  @Post('items') @RequirePermissions('inventory.create') @Audit('inventory.item_create', 'inventory')
  @ApiOperation({ summary: 'Add an item in one or more sizes — each size gets its unified number (SKU)' })
  create(@Body() dto: CreateItemDto, @CurrentUser() u: AuthUser) { return this.inv.create(dto, u?.id); }

  @Patch('items/:id') @RequirePermissions('inventory.edit') @Audit('inventory.item_update', 'inventory')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) { return this.inv.update(id, dto); }

  @Post('reset') @RequirePermissions('inventory.edit') @Audit('inventory.reset', 'inventory') @HttpCode(200)
  @ApiOperation({ summary: 'Super admin: remove every item and movement, leaving one practice item (type CLEAR INVENTORY)' })
  reset(@Body() dto: ResetInventoryDto, @CurrentUser() u: AuthUser) {
    if (!u?.permissions?.includes('*')) throw new ForbiddenException('Only a super admin can clear the inventory.');
    if (dto.confirm !== 'CLEAR INVENTORY') throw new BadRequestException('Type CLEAR INVENTORY to confirm.');
    return this.inv.reset(u.id);
  }

  @Post('movements') @RequirePermissions('inventory.edit') @Audit('inventory.move', 'inventory')
  @ApiOperation({ summary: 'Stock in, stock out, or stock-take correction — several items in one go' })
  move(@Body() dto: MoveDto, @CurrentUser() u: AuthUser) { return this.inv.move(dto, u?.id); }

  @Get('movements') @RequirePermissions('inventory.view')
  movements(@Query() q: MovementQueryDto) { return this.inv.movements(q); }

  @Get('items.csv') @RequirePermissions('inventory.view')
  async itemsCsv(@Query() q: ItemQueryDto, @Res() res: Response) {
    const r = await this.inv.list(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Inventory.csv"');
    res.send(FinanceReportsService.toCsv(
      ['SKU', 'Item ID', 'Item', 'Programme', 'Category', 'Size', 'Unit', 'Condition', 'Current Stock', 'Min Level', 'Status', 'Location', 'Notes'],
      r.items.map((i) => [i.sku, i.itemCode, i.name, i.programme, i.category, i.size, i.unit, i.condition, i.currentStock, i.minLevel, i.status, i.location, i.notes])));
  }

  @Get('movements.csv') @RequirePermissions('inventory.view')
  async movementsCsv(@Query() q: MovementQueryDto, @Res() res: Response) {
    const r = await this.inv.movements({ ...q, limit: 2000 });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Inventory-movements.csv"');
    res.send(FinanceReportsService.toCsv(
      ['Date', 'Type', 'SKU', 'Item', 'Size', 'Quantity', 'Balance After', 'Given to / From', 'Reason', 'Reference', 'Batch'],
      r.map((m) => [m.movedOn, m.type, m.item.sku, m.item.name, m.item.size, m.quantity, m.balanceAfter, m.party, m.reason, m.reference, m.batch])));
  }
}
