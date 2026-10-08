import {
  Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fee, InvoiceStatus, PaymentLink } from '../../database/entities';
import { InstalmentsService } from './instalments.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { DiscountEngine } from './discount-engine.service';
import { SiblingCreditService } from './sibling-credit.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { PricingService } from './pricing.service';
import { DomainEvents } from '../../common/domain-events';
import { CreateProductDto, UpdatePriceEntryDto, UpdateProductDto } from './dto/pricing.dto';
import {
  CreateDiscountDto, CreateFeeDto, GenerateInvoiceDto, RecordPaymentDto, RefundDto,
  SponsorDto, UpdateDiscountDto, UpdateFeeDto, WalletAdjustDto, WriteOffDto, SetSiblingOrderDto,
  InvoiceFilterDto, AdjustInvoiceDto, SetInstalmentsDto, InstalmentFlagDto, WaiveInstalmentDto,
} from './dto/finance.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Finance')
@Controller()
export class FinanceController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly discounts: DiscountEngine,
    private readonly siblingCredits: SiblingCreditService,
    private readonly gateway: PaymentGatewayService,
    private readonly pricing: PricingService,
    private readonly events: DomainEvents,
    @InjectRepository(Fee) private readonly fees: Repository<Fee>,
    @InjectRepository(PaymentLink) private readonly links: Repository<PaymentLink>,
    private readonly instalments: InstalmentsService,
  ) {}

  // ---------------- Price list (2026/27 onwards) ----------------
  @Get('price-list') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'VAT-inclusive prices by sessions a week, category and term option' })
  priceList(@Query('seasonId') seasonId?: string) { return this.pricing.priceList(seasonId); }

  @Patch('price-list/:id') @RequirePermissions('invoice.manage') @Audit('price_list.update', 'price_list')
  updatePrice(@Param('id') id: string, @Body() dto: UpdatePriceEntryDto) { return this.pricing.updateEntry(id, dto as any); }

  // ---------------- Products: kits, leagues, tournaments ----------------
  @Get('products') @RequirePermissions('invoice.view')
  listProducts(@Query('activeOnly') activeOnly?: string) { return this.pricing.listProducts({ activeOnly: activeOnly === 'true' }); }

  @Post('products') @RequirePermissions('invoice.manage') @Audit('product.create', 'product')
  createProduct(@Body() dto: CreateProductDto) { return this.pricing.createProduct(dto as any); }

  @Patch('products/:id') @RequirePermissions('invoice.manage') @Audit('product.update', 'product')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) { return this.pricing.updateProduct(id, dto as any); }

  // ---------------- Fees catalog ----------------
  @Get('fees') @RequirePermissions('invoice.view')
  listFees(@Query('termId') termId?: string) {
    return this.fees.find({
      where: termId ? { termId } : {},
      relations: { term: true, ageGroup: true, location: true },
      order: { createdAt: 'DESC' },
    });
  }
  @Post('fees') @RequirePermissions('invoice.create') @Audit('fee.create', 'fee')
  async createFee(@Body() dto: CreateFeeDto) {
    return this.fees.save(this.fees.create({
      ...dto,
      amount: dto.amount.toFixed(2),
      vatRate: (dto.vatRate ?? 5).toFixed(2),
    } as any));
  }
  @Patch('fees/:id') @RequirePermissions('invoice.edit') @Audit('fee.update', 'fee')
  async updateFee(@Param('id') id: string, @Body() dto: UpdateFeeDto) {
    const patch: any = { ...dto };
    if (dto.amount !== undefined) patch.amount = dto.amount.toFixed(2);
    if (dto.vatRate !== undefined) patch.vatRate = dto.vatRate.toFixed(2);
    await this.fees.update(id, patch);
    return this.fees.findOne({ where: { id } });
  }

  // ---------------- Discounts (rule engine) ----------------
  @Get('discounts') @RequirePermissions('discount.view')
  @ApiOperation({ summary: 'Discount rules (SIBLING / RETURNING / EARLY_BIRD / MANUAL)' })
  listDiscounts() { return this.discounts.list(); }

  @Post('discounts') @RequirePermissions('discount.create') @Audit('discount.create', 'discount')
  createDiscount(@Body() dto: CreateDiscountDto) {
    return this.discounts.create({ ...dto, value: dto.value.toFixed(2) } as any);
  }
  @Patch('discounts/:id') @RequirePermissions('discount.edit') @Audit('discount.update', 'discount')
  updateDiscount(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    const patch: any = { ...dto };
    if (dto.value !== undefined) patch.value = dto.value.toFixed(2);
    return this.discounts.update(id, patch);
  }
  @Delete('discounts/:id') @RequirePermissions('discount.delete') @Audit('discount.deactivate', 'discount')
  removeDiscount(@Param('id') id: string) { return this.discounts.remove(id); }

  @Get('discounts/evaluate') @RequirePermissions('discount.view')
  @ApiOperation({ summary: 'What applies to a player automatically, and what an admin could apply, with reasons' })
  evaluate(@Query('playerId') playerId: string, @Query('amount') amount: string) {
    return this.discounts.evaluate({ playerId, baseAmount: Number(amount || 0) });
  }

  @Get('discounts/sibling-plan') @RequirePermissions('discount.view')
  @ApiOperation({ summary: 'A family\'s sibling ladder: which child pays full price and what each sibling gets' })
  siblingPlan(@Query('guardianId') guardianId: string, @Query('seasonId') seasonId?: string) {
    return this.discounts.siblingPlan({ guardianId, seasonId });
  }

  @Patch('discounts/sibling-order/:guardianId')
  @RequirePermissions('discount.edit')
  @Audit('discount.sibling_order', 'guardian')
  @ApiOperation({ summary: 'Move the full-price position to a different sibling (first id pays full price)' })
  setSiblingOrder(@Param('guardianId') guardianId: string, @Body() dto: SetSiblingOrderDto) {
    return this.discounts.setSiblingOrder(guardianId, dto.orderedPlayerIds);
  }

  // ---------------- Invoices ----------------
  @Get('invoices') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'List invoices (status, guardian, overdueOnly, search)' })
  listInvoices(@Query() q: InvoiceFilterDto) {
    return this.invoices.list(q as any);
  }

  @Get('invoices/outstanding') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Outstanding balances + overdue totals (accurate, ledger-derived)' })
  outstanding() { return this.invoices.outstanding(); }

  @Get('invoices/preview') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Price an enrolment before invoicing — shows discounts and why they apply' })
  preview(@Query('enrolmentId') enrolmentId: string) { return this.invoices.preview(enrolmentId); }

  @Get('invoices/:id') @RequirePermissions('invoice.view')
  getInvoice(@Param('id') id: string) { return this.invoices.findOne(id); }

  @Post('invoices/generate') @RequirePermissions('invoice.create') @Audit('invoice.generate', 'invoice')
  @ApiOperation({ summary: 'Generate an invoice from enrolments — prices + VAT + auto discounts' })
  generate(@Body() dto: GenerateInvoiceDto) { return this.invoices.generateForEnrolments(dto); }

  @Post('invoices/:id/issue') @RequirePermissions('invoice.edit') @Audit('invoice.issue', 'invoice')
  @ApiOperation({ summary: 'Issue a draft invoice. Credits any sibling who moved down the ladder because of it.' })
  async issue(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const invoice = await this.invoices.issue(id);
    const siblingCredits = await this.siblingCredits.reconcileForInvoice(id, user?.id);
    await this.events.emit({ type: 'invoice.issued', invoiceId: id, actorId: user?.id });
    return { ...(await this.invoices.findOne(id)), siblingCredits };
  }

  @Post('invoices/:id/write-off') @RequirePermissions('writeoff.create') @Audit('invoice.writeoff', 'invoice')
  writeOff(@Param('id') id: string, @Body() dto: WriteOffDto) {
    return this.invoices.writeOff(id, dto.amount, dto.reason);
  }
  @Post('invoices/:id/sponsor') @RequirePermissions('invoice.manage') @Audit('invoice.sponsor', 'invoice')
  sponsor(@Param('id') id: string, @Body() dto: SponsorDto) { return this.invoices.markSponsored(id, dto.sponsored); }

  @Get('invoices/:id/training') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Each child\'s training fee: start date, sibling discount, manual discount, net — and whether it can be adjusted' })
  training(@Param('id') id: string) { return this.invoices.trainingSummary(id); }

  @Post('invoices/:id/adjust') @RequirePermissions('invoice.edit') @Audit('invoice.adjust', 'invoice')
  @ApiOperation({ summary: 'Before any payment: change a child\'s start date (prorated) or manual discount and re-price the training lines' })
  adjust(@Param('id') id: string, @Body() dto: AdjustInvoiceDto) { return this.invoices.adjustTraining(id, dto as any); }

  // ---------------- Instalments (manual, set by the academy) ----------------
  @Get('invoices/:id/instalments') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'The instalment plan: each share, due date, what it received and where it stands' })
  instalmentPlan(@Param('id') id: string) { return this.instalments.summary(id); }

  @Put('invoices/:id/instalments') @RequirePermissions('invoice.edit') @Audit('invoice.instalments', 'invoice')
  @ApiOperation({ summary: 'Set 2–5 instalments (percent + due date, adding up to 100%); an empty list removes the plan' })
  setInstalments(@Param('id') id: string, @Body() dto: SetInstalmentsDto) { return this.instalments.setPlan(id, dto.items); }

  @Post('invoices/:id/instalments/:seq/ready') @RequirePermissions('invoice.edit') @Audit('invoice.instalment_ready', 'invoice')
  readyInstalment(@Param('id') id: string, @Param('seq', ParseIntPipe) seq: number, @Body() dto: InstalmentFlagDto) { return this.instalments.setReady(id, seq, dto.ready); }

  @Post('invoices/:id/instalments/:seq/waive') @RequirePermissions('writeoff.create') @Audit('invoice.instalment_waive', 'invoice')
  @ApiOperation({ summary: 'Forgive what is left of an instalment (written off on the invoice, with the reason)' })
  waiveInstalment(@Param('id') id: string, @Param('seq', ParseIntPipe) seq: number, @Body() dto: WaiveInstalmentDto) { return this.instalments.waive(id, seq, dto.reason); }

  @Post('invoices/:id/instalments/:seq/unwaive') @RequirePermissions('writeoff.create') @Audit('invoice.instalment_unwaive', 'invoice')
  unwaiveInstalment(@Param('id') id: string, @Param('seq', ParseIntPipe) seq: number) { return this.instalments.unwaive(id, seq); }

  @Post('invoices/:id/cancel') @RequirePermissions('invoice.edit') @Audit('invoice.cancel', 'invoice')
  cancel(@Param('id') id: string) { return this.invoices.cancel(id); }

  // ---------------- Payments ----------------
  @Get('invoices/:id/payments') @RequirePermissions('payment.view')
  listPayments(@Param('id') id: string) { return this.payments.listForInvoice(id); }

  @Post('invoices/:id/payments') @RequirePermissions('payment.create') @Audit('payment.record', 'invoice')
  @ApiOperation({ summary: 'Record a payment — invoice status recomputes from the ledger' })
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: AuthUser) {
    return this.payments.record({ invoiceId: id, ...dto, recordedById: user?.id });
  }

  @Post('invoices/:id/refund') @RequirePermissions('refund.create') @Audit('payment.refund', 'invoice')
  refund(@Param('id') id: string, @Body() dto: RefundDto, @CurrentUser() user: AuthUser) {
    return this.payments.refund({ invoiceId: id, ...dto, recordedById: user?.id });
  }

  @Post('invoices/:id/pay-from-wallet') @RequirePermissions('payment.create') @Audit('payment.wallet', 'invoice')
  payFromWallet(@Param('id') id: string, @Body() dto: WalletAdjustDto, @CurrentUser() user: AuthUser) {
    return this.payments.payFromWallet(id, dto.amount, user?.id);
  }

  // ---------------- Wallet ----------------
  @Get('guardians/:id/wallet') @RequirePermissions('wallet.view')
  wallet(@Param('id') id: string) { return this.payments.getWallet(id); }

  @Post('guardians/:id/wallet/credit') @RequirePermissions('wallet.manage') @Audit('wallet.credit', 'guardian')
  credit(@Param('id') id: string, @Body() dto: WalletAdjustDto) {
    return this.payments.creditWallet(id, dto.amount, dto.reason);
  }
  @Post('guardians/:id/wallet/debit') @RequirePermissions('wallet.manage') @Audit('wallet.debit', 'guardian')
  debit(@Param('id') id: string, @Body() dto: WalletAdjustDto) {
    return this.payments.debitWallet(id, dto.amount, dto.reason);
  }

  // ---------------- Gateway ----------------
  @Post('invoices/:id/checkout') @RequirePermissions('payment.create') @Audit('payment.checkout', 'invoice')
  @ApiOperation({ summary: 'Create an online checkout link for a parent to pay' })
  async checkout(@Param('id') id: string) {
    const inv = await this.invoices.findOne(id);
    const balance = Number(inv.total) - Number(inv.amountPaid) + Number(inv.amountRefunded);
    const session = await this.gateway.createCheckout({
      invoiceId: inv.id, invoiceNumber: inv.number, amount: balance, customerEmail: inv.guardian?.email,
    });
    return { ...session, live: this.gateway.isLive, note: this.gateway.isLive ? undefined : 'Mock gateway — set PAYMENT_PROVIDER and credentials to go live' };
  }

  @Public()
  @Post('payments/webhook')
  @ApiOperation({ summary: 'Gateway webhook — auto-reconciles payments (signature-verified)' })
  async webhook(@Headers('x-signature') signature: string, @Body() payload: any) {
    if (!this.gateway.verifyWebhook(signature, payload)) {
      return { received: false, error: 'Invalid signature' };
    }
    // The mock driver accepts any signature, so it must never be able to mark an
    // invoice paid on a real system. Only a connected gateway (or an explicit
    // test switch) reconciles payments.
    if (!this.gateway.isLive && process.env.PAYMENT_ALLOW_MOCK_WEBHOOK !== 'true') {
      return { received: false, error: 'No payment gateway is connected' };
    }
    const event = this.gateway.parseWebhook(payload);
    if (event.status === 'PAID' && event.invoiceId && event.amount > 0) {
      const link = event.gatewayId ? await this.links.findOne({ where: { gatewayId: event.gatewayId } }) : null;
      if (link && link.invoiceId !== event.invoiceId) return { received: false, error: 'Payment does not match its link' };
      const dup = event.gatewayId ? await this.payments.findByGatewayId(event.gatewayId) : null;
      if (!dup) {
        await this.payments.record({
          invoiceId: event.invoiceId, amount: event.amount, instalmentSeq: link?.instalmentSeq ?? null,
          method: 'ONLINE' as any, gatewayId: event.gatewayId, notes: link ? 'Paid by payment link' : 'Auto-reconciled from gateway webhook',
        });
      }
      if (link) await this.links.update(link.id, { status: 'PAID', paidAt: new Date() });
    }
    return { received: true, status: event.status };
  }
}
