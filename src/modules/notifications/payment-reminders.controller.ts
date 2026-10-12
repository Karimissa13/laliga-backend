import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PaymentRemindersService } from './payment-reminders.service';
import { DEFAULT_REMINDER_WORDING, REMINDER_PLACEHOLDERS, ReminderKind } from './reminder-email';

const KINDS = ['friendly', 'overdue'];

export class ReminderKindDto {
  @ApiPropertyOptional({ enum: KINDS, description: 'Defaults to overdue past the due date, otherwise friendly' })
  @IsOptional() @IsIn(KINDS) kind?: ReminderKind;
}

export class ReminderListQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'overdue', 'due7'], default: 'all' }) @IsOptional() @IsIn(['all', 'overdue', 'due7']) show?: 'all' | 'overdue' | 'due7';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class SendRemindersDto extends ReminderKindDto {
  @ApiPropertyOptional({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(25) @IsUUID('all', { each: true }) invoiceIds: string[];
}

class WordingDto {
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(120) heading?: string;
  @IsOptional() @IsString() @MaxLength(1000) intro?: string;
}
export class ReminderWordingDto {
  @IsOptional() @ValidateNested() @Type(() => WordingDto) friendly?: WordingDto;
  @IsOptional() @ValidateNested() @Type(() => WordingDto) overdue?: WordingDto;
}

@ApiTags('Email — payment reminders')
@Controller()
export class PaymentRemindersController {
  constructor(private readonly r: PaymentRemindersService) {}

  @Get('invoices/:id/reminder/preview') @RequirePermissions('invoice.view', 'communication.view')
  @ApiOperation({ summary: 'The payment reminder for this invoice as the parent would see it — nothing is sent' })
  preview(@Param('id', ParseUUIDPipe) id: string, @Query() q: ReminderKindDto) { return this.r.preview(id, q.kind); }

  @Post('invoices/:id/reminder') @RequirePermissions('invoice.view', 'communication.create') @Audit('invoice.reminder', 'invoice')
  @ApiOperation({ summary: 'Email the parent a payment reminder for this invoice' })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReminderKindDto) { return this.r.send(id, { kind: dto.kind }); }

  @Get('payment-reminders') @RequirePermissions('invoice.view', 'communication.view')
  @ApiOperation({ summary: 'Every invoice with money owed: what is due now, how late, last reminder' })
  list(@Query() q: ReminderListQueryDto) { return this.r.list(q); }

  @Post('payment-reminders/send') @RequirePermissions('invoice.view', 'communication.create') @Audit('reminder.send', 'communication')
  @ApiOperation({ summary: 'Send payment reminders for up to 25 invoices' })
  sendMany(@Body() dto: SendRemindersDto) { return this.r.sendMany(dto.invoiceIds, { kind: dto.kind }); }

  @Get('payment-reminders/wording') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'The reminder wording (subject, heading, opening paragraph) for each kind' })
  async wording() { return { ...(await this.r.wording()), defaults: DEFAULT_REMINDER_WORDING, placeholders: REMINDER_PLACEHOLDERS }; }

  @Post('payment-reminders/wording') @RequirePermissions('communication.manage') @Audit('reminder.wording', 'settings')
  @ApiOperation({ summary: 'Change the reminder wording' })
  setWording(@Body() dto: ReminderWordingDto) { return this.r.setWording(dto); }
}
