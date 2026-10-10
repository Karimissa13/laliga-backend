import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { BULK_BATCH, InvoiceBulkService } from './invoice-bulk.service';

export class BulkInvoicesDto {
  @ApiProperty({ type: [String], maxItems: BULK_BATCH, description: `Up to ${BULK_BATCH} invoice ids per request` })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_BATCH) @IsUUID('all', { each: true }) ids: string[];
}

/** Bulk actions on the invoices screen. Each invoice is logged in the activity log on its own. */
@ApiTags('Invoices — bulk')
// Not under invoices/… : "invoices/bulk/email" would collide with "invoices/:id/email".
@Controller('invoice-bulk')
export class InvoiceBulkController {
  constructor(private readonly bulk: InvoiceBulkService) {}

  @Post('email') @HttpCode(200) @RequirePermissions('invoice.edit')
  @ApiOperation({ summary: 'Email each selected invoice (PDF attached) to its parent' })
  email(@Body() dto: BulkInvoicesDto, @CurrentUser() user: AuthUser) { return this.bulk.email(dto.ids, user?.id); }

  @Post('payment-links') @HttpCode(200) @RequirePermissions('payment.create')
  @ApiOperation({ summary: 'Email a payment link for what is still owed on each selected invoice' })
  paymentLinks(@Body() dto: BulkInvoicesDto, @CurrentUser() user: AuthUser) { return this.bulk.sendPaymentLinks(dto.ids, user?.id); }
}
