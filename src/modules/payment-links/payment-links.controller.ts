import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PaymentLinkDto } from '../finance/dto/finance.dto';
import { PaymentLinksService } from './payment-links.service';

@ApiTags('Payment links')
@Controller()
export class PaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  @Post('invoices/:id/payment-link') @RequirePermissions('payment.create') @Audit('invoice.payment_link', 'invoice') @HttpCode(200)
  @ApiOperation({ summary: 'Make (or reuse) the payment link for the balance or one instalment — "Copy payment link"' })
  create(@Param('id') id: string, @Body() dto: PaymentLinkDto, @CurrentUser() u: AuthUser) { return this.links.create(id, dto.instalmentSeq, u?.id, dto.balance); }

  @Post('invoices/:id/payment-link/send') @RequirePermissions('payment.create') @Audit('invoice.payment_link_sent', 'invoice') @HttpCode(200)
  @ApiOperation({ summary: 'Email the payment link to the parent (a reminder when past due)' })
  send(@Param('id') id: string, @Body() dto: PaymentLinkDto, @CurrentUser() u: AuthUser) { return this.links.send(id, dto.instalmentSeq, u?.id, dto.balance); }

  @Get('invoices/:id/payment-links') @RequirePermissions('invoice.view')
  list(@Param('id') id: string) { return this.links.forInvoice(id); }

  // ---- what the parent opens (no sign-in; the token is the key) ----
  @Public() @Get('pay/:token')
  @ApiOperation({ summary: 'Parent: what this link is for, the amount, and how to pay' })
  view(@Param('token') token: string) { return this.links.publicView(token); }

  @Public() @Post('pay/:token/checkout') @HttpCode(200)
  @ApiOperation({ summary: 'Parent: start the card payment (only once a gateway is connected)' })
  checkout(@Param('token') token: string) { return this.links.checkout(token); }
}
