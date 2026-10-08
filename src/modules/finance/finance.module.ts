import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AppliedDiscount, Discount, Enrolment, Fee, Guardian, Invoice, InvoiceLineItem,
  Payment, Player, PlayerComment, SiblingCredit, Term, Wallet, WalletTransaction,
  PriceListEntry, Product, Season, Merchant, AppSetting, InvoiceInstalment, PaymentLink,
} from '../../database/entities';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { DiscountEngine } from './discount-engine.service';
import { SiblingCreditService } from './sibling-credit.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { FinanceController } from './finance.controller';
import { PricingService } from './pricing.service';
import { FinanceReportsService } from './finance-reports.service';
import { SettingsService } from './settings.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { MerchantsService } from './merchants.service';
import { ProrationService } from './proration.service';
import { InstalmentsService } from './instalments.service';
import { FinanceReportsController } from './finance-reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    Invoice, InvoiceLineItem, AppliedDiscount, Payment, Fee, Discount,
    Player, PlayerComment, Guardian, Enrolment, Term, Wallet, WalletTransaction, SiblingCredit,
    PriceListEntry, Product, Season, Merchant, AppSetting, InvoiceInstalment, PaymentLink,
  ])],
  controllers: [FinanceController, FinanceReportsController],
  providers: [
    InvoicesService, PaymentsService, DiscountEngine, SiblingCreditService, PaymentGatewayService, PricingService,
    FinanceReportsService, SettingsService, InvoicePdfService, MerchantsService, ProrationService, InstalmentsService,
  ],
  exports: [
    InvoicesService, PaymentsService, DiscountEngine, SiblingCreditService, PricingService, PaymentGatewayService,
    FinanceReportsService, SettingsService, InvoicePdfService, MerchantsService, ProrationService, InstalmentsService,
  ],
})
export class FinanceModule {}
