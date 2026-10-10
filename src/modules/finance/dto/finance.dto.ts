import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber,
  IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MANUAL_PRESET_CODES } from '../manual-discounts';
import {
  DiscountKind, DiscountRule, InvoiceType, PaymentMethod, ProgramType,
} from '../../../database/entities';

// ---- Fees ----
export class CreateFeeDto {
  @ApiProperty() @IsUUID() termId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
  @ApiProperty({ example: 3801, description: 'Amount excluding VAT' })
  @IsNumber() @Min(0) amount: number;
  @ApiPropertyOptional({ default: 5 }) @IsOptional() @IsNumber() vatRate?: number;
  @ApiPropertyOptional({ enum: ProgramType }) @IsOptional() @IsEnum(ProgramType) programType?: ProgramType;
}
export class UpdateFeeDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() vatRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Discounts ----
export class CreateDiscountDto {
  @ApiProperty({ example: 'Returning player 15%' }) @IsString() name: string;
  @ApiPropertyOptional({ enum: DiscountKind }) @IsOptional() @IsEnum(DiscountKind) kind?: DiscountKind;
  @ApiProperty({ example: 15 }) @IsNumber() value: number;
  @ApiProperty({ enum: DiscountRule, example: 'RETURNING' }) @IsEnum(DiscountRule) rule: DiscountRule;
  @ApiPropertyOptional({
    example: { tiers: [15, 25], beyond: 25 },
    description: 'Rule parameters. SIBLING: { tiers: [2nd%, 3rd%], beyond: 4th+% }. EARLY_BIRD: { cutoffDate }',
  })
  @IsOptional() @IsObject() params?: Record<string, any>;
  @ApiPropertyOptional({ description: 'Apply without being asked. Only the sibling rule should be automatic.' })
  @IsOptional() @IsBoolean() isAutomatic?: boolean;
}
export class UpdateDiscountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAutomatic?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() value?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() params?: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Invoices ----
export class GenerateInvoiceDto {
  @ApiProperty({ type: [String], description: 'Enrolments to bill (same guardian)' })
  @IsArray() @ArrayNotEmpty() @IsUUID('4', { each: true })
  enrolmentIds: string[];
  @ApiPropertyOptional({ enum: InvoiceType }) @IsOptional() @IsEnum(InvoiceType) type?: InvoiceType;
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @IsInt() dueInDays?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) installments?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({
    description: 'Per-child manual discount keyed by playerId. Replaces that child\'s automatic sibling discount — discounts do not stack.',
    example: { 'b1f…': { amount: 300, label: 'Goodwill — coach promise', reason: 'Approved by Karim' } },
  })
  @IsOptional() @IsObject() manualDiscounts?: Record<string, { amount: number; label: string; reason: string }>;
}

export class SetSiblingOrderDto {
  @ApiProperty({
    type: [String],
    description: 'Children in ladder order: the FIRST id pays full price, the rest take 15% / 25% / 25%. Send an empty array to return to the default (eldest pays full).',
  })
  @IsArray() @IsUUID('4', { each: true })
  orderedPlayerIds: string[];
}

export class WriteOffDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiProperty() @IsString() reason: string;
  @ApiPropertyOptional({ description: 'Issue a tax credit note for it (leave off for a bad debt)', default: false })
  @IsOptional() @IsBoolean() creditNote?: boolean;
}
export class SponsorDto {
  @ApiProperty() @IsBoolean() sponsored: boolean;
}

// ---- Payments ----
export class RecordPaymentDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) method: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() paidAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Card acquirer / payment-link merchant (Network, Payfort …)' })
  @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional({ description: 'The instalment this payment is for (1–5), when the invoice is paid in instalments' })
  @IsOptional() @IsInt() @Min(1) @Max(5) instalmentSeq?: number;
}
export class RefundDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ description: 'Credit the guardian wallet instead of paying out' })
  @IsOptional() @IsBoolean() toWallet?: boolean;
}
export class WalletAdjustDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

// ---- Query filters ----
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { InvoiceStatus } from '../../../database/entities';

export class InvoiceFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: InvoiceStatus }) @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() guardianId?: string;
  @ApiPropertyOptional({ description: 'Only overdue invoices' }) @IsOptional() @IsString() overdueOnly?: string;
}

/** A child's manual discount when adjusting an invoice: a preset or any percentage. */
export class AdjustDiscountDto {
  @ApiPropertyOptional({ enum: MANUAL_PRESET_CODES }) @IsOptional() @IsIn(MANUAL_PRESET_CODES) preset?: string;
  @ApiPropertyOptional({ example: 12.5, description: 'Any percentage off the training fee (0.01–100)' })
  @ValidateIf((o) => !o.preset) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) percent?: number;
  @ApiPropertyOptional({ example: 'Approved by Karim' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class AdjustChildDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiPropertyOptional({ example: '2026-10-12', nullable: true, description: 'First training day; null charges from the first day of the term' })
  @IsOptional() @IsDateString() startDate?: string | null;
  @ApiPropertyOptional({ type: AdjustDiscountDto, nullable: true, description: 'null removes the manual discount (the sibling discount comes back)' })
  @IsOptional() @ValidateNested() @Type(() => AdjustDiscountDto) discount?: AdjustDiscountDto | null;
}
export class AdjustInvoiceDto {
  @ApiProperty({ type: [AdjustChildDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8)
  @ValidateNested({ each: true }) @Type(() => AdjustChildDto) children: AdjustChildDto[];
}

// ---- Instalments (manual, set by the academy) ----
export class InstalmentItemDto {
  @ApiProperty({ example: 40, description: 'Share of the invoice total, % (two decimals at most)' })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99.99) percent: number;
  @ApiProperty({ example: '2026-10-15' }) @IsDateString() dueDate: string;
}
export class SetInstalmentsDto {
  @ApiProperty({ type: [InstalmentItemDto], description: '2 to 5 instalments adding up to 100%; an empty list removes the plan' })
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InstalmentItemDto) items: InstalmentItemDto[];
}
export class InstalmentFlagDto {
  @ApiProperty() @IsBoolean() ready: boolean;
}
export class WaiveInstalmentDto {
  @ApiProperty({ example: 'Approved by Karim — family hardship' }) @IsString() @MaxLength(200) reason: string;
  @ApiPropertyOptional({ description: 'Issue a tax credit note for it (then the waiver cannot be undone)', default: false })
  @IsOptional() @IsBoolean() creditNote?: boolean;
}
export class PaymentLinkDto {
  @ApiPropertyOptional({ description: 'Instalment number; omitted on a plan = the "ready to pay" (or next unpaid) instalment' }) @IsOptional() @IsInt() @Min(1) @Max(5) instalmentSeq?: number;
  @ApiPropertyOptional({ description: 'The whole balance, even on an instalment plan' }) @IsOptional() @IsBoolean() balance?: boolean;
}
