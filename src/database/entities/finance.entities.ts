import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
  OneToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import {
  CreditNoteKind, DiscountKind, DiscountRule, InvoiceStatus, InvoiceType, PaymentDirection,
  PaymentMethod, PaymentStatus, WalletTxnType, ProgramType, RevenueStream, KitType, TermPackage,
  TeamLevel, AcademyEventKind,
} from './enums';
import { Guardian, Player } from './people.entities';
import { Term, Location, AgeGroup, Season } from './structure.entities';

// Decimal columns are returned as strings by pg; services parse as needed.
const dec = { type: 'decimal', precision: 10, scale: 2 } as const;

@Entity('fees')
export class Fee {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() termId: string;
  @ManyToOne(() => Term) @JoinColumn({ name: 'termId' }) term: Term;
  @Column({ nullable: true }) ageGroupId?: string;
  @ManyToOne(() => AgeGroup, { nullable: true }) @JoinColumn({ name: 'ageGroupId' }) ageGroup?: AgeGroup;
  @Column({ nullable: true }) locationId?: string;
  @ManyToOne(() => Location, { nullable: true }) @JoinColumn({ name: 'locationId' }) location?: Location;
  @Column({ nullable: true }) level?: string;
  @Column(dec) amount: string;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5 }) vatRate: string;
  @Column({ type: 'enum', enum: ProgramType, default: ProgramType.TERM }) programType: ProgramType;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() number: string;
  @Index() @Column() guardianId: string;
  @ManyToOne(() => Guardian) @JoinColumn({ name: 'guardianId' }) guardian: Guardian;
  @Column({ type: 'enum', enum: InvoiceType, default: InvoiceType.STANDARD }) type: InvoiceType;
  @Index() @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT }) status: InvoiceStatus;
  @Column({ type: 'date', nullable: true }) issueDate?: string;
  @Column({ type: 'date', nullable: true }) dueDate?: string;
  @Column({ ...dec, default: 0 }) subtotal: string;
  @Column({ ...dec, default: 0 }) discountTotal: string;
  @Column({ ...dec, default: 0 }) vatTotal: string;
  @Column({ ...dec, default: 0 }) total: string;
  @Column({ ...dec, default: 0 }) amountPaid: string;
  @Column({ ...dec, default: 0 }) amountRefunded: string;
  @Column({ ...dec, default: 0 }) writeOffAmount: string;
  @Column({ nullable: true }) writeOffReason?: string;
  @Column({ default: false }) isSponsored: boolean;
  @Column({ type: 'int', default: 1 }) installments: number;
  @Column({ type: 'text', nullable: true }) notes?: string;
  @OneToMany(() => InvoiceLineItem, (l) => l.invoice) lineItems: InvoiceLineItem[];
  @OneToMany(() => Payment, (p) => p.invoice) payments: Payment[];
  @OneToMany(() => AppliedDiscount, (d) => d.invoice) discounts: AppliedDiscount[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('invoice_line_items')
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() invoiceId: string;
  @ManyToOne(() => Invoice, (i) => i.lineItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;
  @Column({ nullable: true }) playerId?: string;
  @ManyToOne(() => Player, { nullable: true }) @JoinColumn({ name: 'playerId' }) player?: Player;
  @Column() description: string;
  @Column({ type: 'int', default: 1 }) quantity: number;
  @Column(dec) unitAmount: string;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5 }) vatRate: string;
  @Column(dec) lineTotal: string;
  /** Revenue stream for the finance dashboard. Term fees are ACADEMY. */
  @Index() @Column({ type: 'enum', enum: RevenueStream, default: RevenueStream.ACADEMY }) stream: RevenueStream;
  /** Catalogue product sold on this line (kits, league, tournaments). Null for term fees and custom items. */
  @Column({ type: 'uuid', nullable: true }) productId?: string | null;
  /** Kit pieces sold, copied from the product at the time of sale so later edits never rewrite history. */
  @Column({ type: 'jsonb', nullable: true }) kitItems?: Array<{ type: KitType; qty: number }> | null;
  /** Term option for a fee line (T1 … FULL). */
  @Column({ type: 'varchar', length: 8, nullable: true }) package?: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() invoiceId: string;
  @ManyToOne(() => Invoice, (i) => i.payments)
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;
  @Column({ type: 'enum', enum: PaymentDirection, default: PaymentDirection.INBOUND }) direction: PaymentDirection;
  @Column(dec) amount: string;
  @Column({ type: 'enum', enum: PaymentMethod }) method: PaymentMethod;
  @Index() @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.COMPLETED }) status: PaymentStatus;
  @Column({ nullable: true }) reference?: string;
  @Column({ nullable: true }) gatewayId?: string;
  /** Card acquirer / payment-link provider (Network, Payfort …), copied at the time of payment. */
  @Column({ type: 'uuid', nullable: true }) merchantId?: string | null;
  @Column({ type: 'varchar', nullable: true }) merchantName?: string | null;
  @Column({ type: 'varchar', nullable: true }) merchantNumber?: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) paidAt: Date;
  @Column({ nullable: true }) recordedById?: string;
  @Column({ nullable: true }) notes?: string;
  /** Which instalment this payment was taken for (1–5), when the invoice has a plan. */
  @Column({ type: 'int', nullable: true }) instalmentSeq?: number | null;
  @CreateDateColumn() createdAt: Date;
}

/**
 * A tax credit note: the document that reduces an issued tax invoice when money
 * is refunded, an amount is forgiven, or the invoice is cancelled. It is a record —
 * never edited or deleted; its amounts mirror the ledger entry that caused it, so
 * it never changes a total by itself. Numbered CN-000001 from its own sequence.
 */
@Entity('credit_notes')
export class CreditNote {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() number: string;
  @Index() @Column() invoiceId: string;
  @ManyToOne(() => Invoice) @JoinColumn({ name: 'invoiceId' }) invoice: Invoice;
  @Index() @Column() guardianId: string;
  @ManyToOne(() => Guardian) @JoinColumn({ name: 'guardianId' }) guardian: Guardian;
  @Column({ type: 'enum', enum: CreditNoteKind }) kind: CreditNoteKind;
  @Index() @Column({ type: 'date' }) issueDate: string;
  /** Amount credited, VAT included, and its split. */
  @Column(dec) total: string;
  @Column(dec) vatAmount: string;
  @Column(dec) netAmount: string;
  @Column({ type: 'varchar', length: 250 }) reason: string;
  /** The refund payment it documents (REFUND). */
  @Column({ type: 'uuid', nullable: true }) paymentId?: string | null;
  /** The waived instalment it documents (WRITE_OFF from a waiver). */
  @Column({ type: 'int', nullable: true }) instalmentSeq?: number | null;
  @Column({ type: 'uuid', nullable: true }) createdById?: string | null;
  @CreateDateColumn() createdAt: Date;
}

/**
 * An invoice paid in instalments (2 to 5), set by the academy, never by the
 * parent: each instalment's share of the total and its due date are typed in by
 * staff. Paid / overdue is worked out from the payments ledger; "ready to pay"
 * and "waived" are the desk's own flags.
 */
@Entity('invoice_instalments')
@Index(['invoiceId', 'seq'], { unique: true })
export class InvoiceInstalment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() invoiceId: string;
  @ManyToOne(() => Invoice, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'invoiceId' }) invoice: Invoice;
  @Column({ type: 'int' }) seq: number;
  @Column({ type: 'decimal', precision: 5, scale: 2 }) percent: string;
  @Column(dec) amount: string;
  @Column({ type: 'date' }) dueDate: string;
  /** NONE, READY (the one the parent should pay now) or WAIVED (forgiven — written off). */
  @Column({ type: 'varchar', length: 8, default: 'NONE' }) flag: string;
  @Column({ ...dec, default: 0 }) waivedAmount: string;
  @Column({ type: 'varchar', nullable: true }) waivedReason?: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/**
 * A link a parent opens to pay an invoice (or one instalment) online. Made by
 * the system; it takes real money once a gateway (Payfort / Network) is set up —
 * until then the page shows the bank-transfer details instead.
 */
@Entity('payment_links')
export class PaymentLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 64 }) token: string;
  @Index() @Column() invoiceId: string;
  @ManyToOne(() => Invoice, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'invoiceId' }) invoice: Invoice;
  @Column({ type: 'int', nullable: true }) instalmentSeq?: number | null;
  @Column(dec) amount: string;
  /** ACTIVE, PAID, CANCELLED or EXPIRED. */
  @Index() @Column({ type: 'varchar', length: 10, default: 'ACTIVE' }) status: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'varchar', nullable: true }) createdById?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sentAt?: Date | null;
  @Column({ type: 'varchar', nullable: true }) sentTo?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) openedAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) paidAt?: Date | null;
  @Column({ type: 'varchar', nullable: true }) gatewayId?: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('discounts')
export class Discount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ type: 'enum', enum: DiscountKind, default: DiscountKind.PERCENTAGE }) kind: DiscountKind;
  @Column(dec) value: string;
  @Column({ type: 'enum', enum: DiscountRule, default: DiscountRule.MANUAL }) rule: DiscountRule;
  @Column({ type: 'jsonb', nullable: true }) params?: Record<string, any>;
  @Column({ default: true }) isActive: boolean;
  /**
   * `rule` says how eligibility is computed. `isAutomatic` says whether the system
   * is allowed to apply it without being asked. Only the sibling discount is
   * automatic at this academy; returning-player and early-bird remain in the
   * catalogue so an admin can apply them deliberately for a campaign.
   */
  @Column({ default: false }) isAutomatic: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('applied_discounts')
export class AppliedDiscount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() invoiceId: string;
  @ManyToOne(() => Invoice, (i) => i.discounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;
  @Column({ nullable: true }) discountId?: string;
  @ManyToOne(() => Discount, { nullable: true }) @JoinColumn({ name: 'discountId' }) discount?: Discount;
  /**
   * Which child this discount belongs to. Null means an invoice-level discount.
   * Without this the system could not tell which sibling had been discounted, so
   * "one discount per child" was unenforceable.
   */
  @Index() @Column({ nullable: true }) playerId?: string;
  @ManyToOne(() => Player, { nullable: true }) @JoinColumn({ name: 'playerId' }) player?: Player;
  @Column() label: string;
  @Column({ type: 'enum', enum: DiscountRule, default: DiscountRule.MANUAL }) rule: DiscountRule;
  @Column(dec) amount: string;
  /** False when an admin applied or overrode it by hand. */
  @Column({ default: true }) wasAutomatic: boolean;
  /** Why it applied, in the words shown to the admin — kept for later disputes. */
  @Column({ type: 'text', nullable: true }) reason?: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() guardianId: string;
  @OneToOne(() => Guardian) @JoinColumn({ name: 'guardianId' }) guardian: Guardian;
  @Column({ ...dec, default: 0 }) balance: string;
  @OneToMany(() => WalletTransaction, (t) => t.wallet) transactions: WalletTransaction[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() walletId: string;
  @ManyToOne(() => Wallet, (w) => w.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;
  @Column({ type: 'enum', enum: WalletTxnType }) type: WalletTxnType;
  @Column(dec) amount: string;
  @Column({ nullable: true }) reason?: string;
  @CreateDateColumn() createdAt: Date;
}

/**
 * A sibling discount owed retrospectively. When an older child registers after a
 * younger one in the same term, the younger one moves down the sibling ladder
 * (1st → 2nd child, say) after their invoice was already issued at the old rate.
 *
 * The issued invoice is never edited. The difference is credited to the family
 * wallet and, if that invoice still has a balance, applied to it as a wallet
 * payment. One row per credit, so the same difference can never be paid twice:
 * a later re-rank credits only what is still owed after the rows already here.
 */
@Entity('sibling_credits')
@Index(['playerId', 'termId'])
export class SiblingCredit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() guardianId: string;
  /** The child who is owed. */
  @Column() playerId: string;
  @ManyToOne(() => Player) @JoinColumn({ name: 'playerId' }) player: Player;
  @Column() termId: string;
  /** Their already-issued invoice the credit relates to. */
  @Column() invoiceId: string;
  /** The invoice whose issue caused the re-rank. */
  @Column() triggeredByInvoiceId: string;
  @Column({ type: 'int' }) percentBefore: number;
  @Column({ type: 'int' }) percentAfter: number;
  @Column(dec) netAmount: string;
  @Column(dec) vatAmount: string;
  @Column(dec) totalAmount: string;
  /** How much of the credit went straight onto the invoice (the rest stays in the wallet). */
  @Column({ ...dec, default: 0 }) appliedToInvoice: string;
  @Column({ type: 'text' }) reason: string;
  @CreateDateColumn() createdAt: Date;
}

/**
 * The academy price list: one row per sessions-a-week tier and category, with a
 * VAT-inclusive price for each of the six term options. Replaces the per-term
 * fee rows for term fees (those stay as a fallback for older data).
 */
@Entity('price_list')
@Index(['seasonId', 'sessionsPerWeek', 'category'], { unique: true })
export class PriceListEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() seasonId: string;
  @ManyToOne(() => Season) @JoinColumn({ name: 'seasonId' }) season: Season;
  /** 1, 2 or 3 sessions a week. */
  @Column({ type: 'int' }) sessionsPerWeek: number;
  /** Age category code (U6 … U18) or GIRLS for a girls-only squad. */
  @Column() category: string;
  /** Rate per session shown on the price list, for reference. */
  @Column({ ...dec, nullable: true }) sessionRate?: string | null;
  /** VAT-inclusive prices, keyed by TermPackage. Missing key = not offered. */
  @Column({ type: 'jsonb' }) prices: Partial<Record<TermPackage, number>>;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5 }) vatRate: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** Things sold besides term fees: kits, the Man City league, tournaments. */
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() code: string;
  @Column() name: string;
  @Column({ type: 'text', nullable: true }) description?: string | null;
  @Column({ type: 'enum', enum: RevenueStream, default: RevenueStream.OTHER }) stream: RevenueStream;
  /** VAT-inclusive price. */
  @Column(dec) priceInclVat: string;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5 }) vatRate: string;
  /** Levels it is offered to at registration; empty = every level. */
  @Column({ type: 'enum', enum: TeamLevel, array: true, default: '{}' }) levels: TeamLevel[];
  /** Kit pieces included, for the kit-sales chart. */
  @Column({ type: 'jsonb', default: () => "'[]'" }) kitItems: Array<{ type: KitType; qty: number }>;
  /** Offered as a tick-box on the registration screen. */
  @Column({ default: false }) offerAtRegistration: boolean;
  @Column({ type: 'int', default: 100 }) sortOrder: number;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** Calendar entries for the dashboard timeline: pitch bookings, matches, tournaments, holidays. */
@Entity('academy_events')
export class AcademyEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid', nullable: true }) seasonId?: string | null;
  @Column({ type: 'enum', enum: AcademyEventKind }) kind: AcademyEventKind;
  @Column() title: string;
  @Index() @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Column({ type: 'uuid', nullable: true }) locationId?: string | null;
  @ManyToOne(() => Location, { nullable: true }) @JoinColumn({ name: 'locationId' }) location?: Location | null;
  @Column({ type: 'text', nullable: true }) notes?: string | null;
  /** No training on these days (public holidays, school breaks) — the season schedule skips them. */
  @Column({ default: false }) noTraining: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** A card acquirer or payment-link provider and its merchant ID (MID). */
@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  /** Merchant ID issued by the provider, as printed on the settlement report. */
  @Column() merchantNumber: string;
  /** Payment methods this merchant is used for (CARD, ONLINE …). */
  @Column({ type: 'enum', enum: PaymentMethod, array: true, default: '{}' }) methods: PaymentMethod[];
  @Column({ type: 'uuid', nullable: true }) locationId?: string | null;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** Small key/value settings — e.g. the invoice profile (company, bank, terms). */
@Entity('app_settings')
export class AppSetting {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() key: string;
  @Column({ type: 'jsonb' }) value: any;
  @UpdateDateColumn() updatedAt: Date;
}
