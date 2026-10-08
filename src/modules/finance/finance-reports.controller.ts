import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { InvoiceStatus, PaymentMethod } from '../../database/entities';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { FinanceReportsService, METHOD_LABEL } from './finance-reports.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { MerchantsService } from './merchants.service';
import { InvoiceProfile, NotificationSettings, SettingsService } from './settings.service';

const bool = ({ value }: { value: any }) => (value === undefined || value === '' ? undefined : value === true || value === 'true');
const num = ({ value }: { value: any }) => (value === undefined || value === '' ? undefined : Number(value));

export class PaymentReportQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional({ description: 'Invoice, player or parent number, name or payment reference' })
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ default: true, description: 'Include wallet applications as rows' })
  @IsOptional() @Transform(bool) @IsBoolean() includeWallet?: boolean;
}

export class InvoiceRegisterQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @ApiPropertyOptional({ example: '1987' }) @IsOptional() @IsString() @MaxLength(20) invoiceNo?: string;
  @ApiPropertyOptional({ example: '677' }) @IsOptional() @IsString() @MaxLength(20) playerNo?: string;
  @ApiPropertyOptional({ example: '27' }) @IsOptional() @IsString() @MaxLength(20) parentNo?: string;
  @ApiPropertyOptional({ enum: [...Object.values(InvoiceStatus), 'OVERDUE'] })
  @IsOptional() @IsIn([...Object.values(InvoiceStatus), 'OVERDUE']) status?: string;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional({ enum: ['only', 'exclude'] }) @IsOptional() @IsIn(['only', 'exclude']) additional?: 'only' | 'exclude';
  @ApiPropertyOptional({ enum: ['only', 'exclude'] }) @IsOptional() @IsIn(['only', 'exclude']) custom?: 'only' | 'exclude';
  @ApiPropertyOptional() @IsOptional() @IsUUID() ageGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() invoiceFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() invoiceTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() paymentFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() paymentTo?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() amountFrom?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() amountTo?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Transform(num) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Transform(num) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class MerchantDto {
  @ApiProperty({ example: 'Network International' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: '13435' }) @IsString() @MinLength(1) @MaxLength(40) merchantNumber: string;
  @ApiPropertyOptional({ enum: PaymentMethod, isArray: true }) @IsOptional() @IsArray() @IsEnum(PaymentMethod, { each: true }) methods?: PaymentMethod[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
}
export class UpdateMerchantDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) merchantNumber?: string;
  @ApiPropertyOptional({ enum: PaymentMethod, isArray: true }) @IsOptional() @IsArray() @IsEnum(PaymentMethod, { each: true }) methods?: PaymentMethod[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class BankDto {
  @IsString() @MaxLength(120) bankName: string;
  @IsString() @MaxLength(160) accountName: string;
  @IsString() @MaxLength(80) branch: string;
  @IsString() @MaxLength(20) swift: string;
  @IsString() @MaxLength(40) accountNumber: string;
  @IsString() @MaxLength(40) iban: string;
}
export class InvoiceProfileDto {
  @ApiProperty() @IsString() @MaxLength(160) companyName: string;
  @ApiProperty() @IsString() @MaxLength(300) addressLine: string;
  @ApiProperty() @IsString() @MaxLength(30) trn: string;
  @ApiProperty() @IsString() @MaxLength(80) academyName: string;
  @ApiProperty() @IsString() @MaxLength(120) paymentTerms: string;
  @ApiProperty() @IsString() @MaxLength(160) chequePayee: string;
  @ApiProperty({ type: BankDto }) @ValidateNested() @Type(() => BankDto) bank: BankDto;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(400, { each: true }) terms: string[];
}
export class NotificationSettingsDto {
  @ApiProperty() @IsBoolean() autoEmailInvoices: boolean;
  @ApiProperty() @IsBoolean() autoWelcome: boolean;
  @ApiProperty({ example: 'https://portal.laligaacademyabudhabi.com/parent/' }) @IsString() @MaxLength(200) portalUrl: string;
  @ApiProperty() @IsString() @MaxLength(80) fromName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) replyTo: string;
}

const dmy = (d: any) => {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai' });   // DD/MM/YYYY
};
const f2 = (n: number) => Number(n || 0).toFixed(2);

@ApiTags('Finance reports')
@Controller()
export class FinanceReportsController {
  constructor(
    private readonly reports: FinanceReportsService,
    private readonly pdf: InvoicePdfService,
    private readonly merchants: MerchantsService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------- Payment report ----------------
  @Get('reports/payments') @RequirePermissions('payment.view')
  @ApiOperation({ summary: 'Payment Report — one row per payment; Received = direct money only, Wallet separate' })
  paymentReport(@Query() q: PaymentReportQueryDto) { return this.reports.paymentReport(q); }

  @Get('reports/payments.csv') @RequirePermissions('payment.view')
  async paymentReportCsv(@Query() q: PaymentReportQueryDto, @Res() res: Response) {
    const r = await this.reports.paymentReport(q);
    const csv = FinanceReportsService.toCsv(
      ['SL', 'Date', 'Payment Method', 'Merchant', 'Merchant ID', 'Payment Reference', 'Location', 'Player No.', 'Invoice#', 'Received', 'Wallet', 'Balance'],
      [
        ...r.rows.map((x) => [x.sl, dmy(x.date), x.methodLabel, x.merchant, x.merchantId, x.reference, x.location,
          (x.players || []).map((p: any) => p.ref).join(' '), x.invoice.number, f2(x.received), f2(x.wallet), f2(x.balance)]),
        ['', '', '', '', '', '', '', '', 'Total', f2(r.totals.received), f2(r.totals.wallet), f2(r.totals.balance)],
      ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Payment-Report-${q.from ?? 'all'}-${q.to ?? 'all'}.csv"`);
    res.send(csv);
  }

  @Get('reports/payment-methods') @RequirePermissions('payment.view')
  methods() { return Object.entries(METHOD_LABEL).map(([key, label]) => ({ key, label })); }

  // ---------------- Invoice register (the invoices screen) ----------------
  @Get('invoice-register') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Invoices with every column of the legacy screen and its full search' })
  register(@Query() q: InvoiceRegisterQueryDto) { return this.reports.invoiceRegister(q); }

  @Get('invoice-register.csv') @RequirePermissions('invoice.view')
  async registerCsv(@Query() q: InvoiceRegisterQueryDto, @Res() res: Response) {
    const r = await this.reports.invoiceRegister(q, { all: true });
    const csv = FinanceReportsService.toCsv(
      ['Invoice No', 'Parent No', 'Parent', 'Email', 'Mobile', 'Players', 'Players Count', 'Subscription Details', 'Location',
        'Total Amount Including VAT', 'Total Amount Excluding VAT', 'VAT Amount', 'Discount', 'Partial Refund Including VAT', 'Refund Reason',
        'Write Off Amount Including VAT', 'Write Off Reason', 'Amount Received Including VAT', 'VAT on Received Amount',
        'Net Amount Received Excluding VAT', 'Wallet Applied', 'Total Pending Amount Including VAT', 'VAT on Pending Amount',
        'Net Amount Pending Excluding VAT', 'Total Installments', 'Paid Installments', 'Pending Installments', 'Invoice Date',
        'Due Date', 'Payment Status', 'Payment Date', 'Payment Method', 'Additional Invoice', 'Emailed'],
      r.data.map((i) => [i.number, i.parent.ref, i.parent.name, i.parent.email, i.parent.mobile,
        (i.players || []).map((p: any) => `${p.ref} : ${p.name}`).join('; '), i.playersCount, i.subscription, i.location,
        f2(i.totalInclVat), f2(i.totalExclVat), f2(i.vat), f2(i.discount), f2(i.refunded), i.refundReason,
        f2(i.writeOff), i.writeOffReason, f2(i.received), f2(i.vatOnReceived), f2(i.netReceived), f2(i.wallet),
        f2(i.pending), f2(i.vatOnPending), f2(i.netPending), i.installments.total, i.installments.paid, i.installments.pending,
        dmy(i.issueDate), dmy(i.dueDate), i.overdue ? 'OVERDUE' : i.status, dmy(i.lastPaymentAt), i.methods.join(', '),
        i.additional ? 'Yes' : 'No', i.emailedAt ? dmy(i.emailedAt) : '']));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Invoices.csv"');
    res.send(csv);
  }

  // ---------------- Invoice PDF ----------------
  @Get('invoices/:id/pdf') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'The designed tax invoice as a PDF (inline; ?download=true to save)' })
  async invoicePdf(@Param('id') id: string, @Query('download') download: string, @Res() res: Response) {
    const r = await this.pdf.render(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download === 'true' ? 'attachment' : 'inline'}; filename="${r.fileName}"`);
    res.send(r.buffer);
  }

  // ---------------- Merchants ----------------
  @Get('merchants') @RequirePermissions('payment.view')
  listMerchants(@Query('activeOnly') a?: string) { return this.merchants.list(a === 'true'); }

  @Post('merchants') @RequirePermissions('settings.manage') @Audit('merchant.create', 'merchant')
  createMerchant(@Body() dto: MerchantDto) { return this.merchants.create(dto); }

  @Patch('merchants/:id') @RequirePermissions('settings.manage') @Audit('merchant.update', 'merchant')
  updateMerchant(@Param('id') id: string, @Body() dto: UpdateMerchantDto) { return this.merchants.update(id, dto); }

  // ---------------- Settings ----------------
  @Get('settings/invoice-profile') @RequirePermissions('invoice.view')
  invoiceProfile() { return this.settings.invoiceProfile(); }

  @Put('settings/invoice-profile') @RequirePermissions('settings.manage') @Audit('settings.invoice_profile', 'settings')
  setInvoiceProfile(@Body() dto: InvoiceProfileDto) { return this.settings.set<InvoiceProfile>('invoiceProfile', dto); }

  @Get('settings/notifications') @RequirePermissions('communication.view')
  notifications() { return this.settings.notifications(); }

  @Put('settings/notifications') @RequirePermissions('settings.manage') @Audit('settings.notifications', 'settings')
  setNotifications(@Body() dto: NotificationSettingsDto) { return this.settings.set<NotificationSettings>('notifications', dto); }
}
