import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../../database/entities';

/** The company block, bank details and terms printed on every invoice. */
export interface InvoiceProfile {
  companyName: string;
  addressLine: string;
  trn: string;
  academyName: string;
  paymentTerms: string;
  chequePayee: string;
  bank: { bankName: string; accountName: string; branch: string; swift: string; accountNumber: string; iban: string };
  terms: string[];
}

export interface NotificationSettings {
  /** Email the invoice (PDF attached) to the parent as soon as it is issued. */
  autoEmailInvoices: boolean;
  /** Email the parent their sign-in details when their first child is registered. */
  autoWelcome: boolean;
  /** Address of the parent sign-in page, used in the welcome email. */
  portalUrl: string;
  fromName: string;
  replyTo: string;
}

/** From the academy's current invoice (INVAB-19328960, Sept 2026). */
export const DEFAULT_INVOICE_PROFILE: InvoiceProfile = {
  companyName: 'Inspiratus Consulting Limited for Consultancy & Events LLC',
  addressLine: 'Zayed Sports City, Airport Road, Abu Dhabi, United Arab Emirates, PO BOX: 862',
  trn: '100496243500003',
  academyName: 'Laliga Academy',
  paymentTerms: 'Upon confirmation',
  chequePayee: 'Inspiratus Consulting Limited for Consultancy & Events LLC',
  bank: {
    bankName: 'Emirates NBD',
    accountName: 'Inspiratus Consulting Limited for Consultancy & Events LLC',
    branch: 'Jebel Ali',
    swift: 'EBILAEAD',
    accountNumber: '101-5464 3451-01',
    iban: 'AE830260001015464345101',
  },
  terms: [
    'This payment is non-refundable',
    'Places are limited and are only guaranteed upon payment of this invoice and based on space availability at the time of payment',
    'Payment is required prior to commencement of each term',
    'Selection for Advanced Development and HPC Teams will incur additional costs which will be invoiced separately',
    'Participation in tournaments and leagues will incur additional participation and match kit fees which will be invoiced separately',
    'Missed classes cannot be re-scheduled. (No makeup sessions)',
    'If choosing to pay by bank transfer, please make sure to indicate under payment details: "[Academy Name] – [Name of Player]" and share the transfer confirmation with us so we can track your payment',
  ],
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  autoEmailInvoices: true,
  autoWelcome: true,
  portalUrl: process.env.PORTAL_URL || 'http://localhost:3000/parent/',
  fromName: 'LaLiga Academy Abu Dhabi',
  replyTo: '',
};

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.settings.findOne({ where: { key } });
    return row ? ({ ...(fallback as any), ...row.value } as T) : fallback;
  }

  async set<T>(key: string, value: T): Promise<T> {
    const row = await this.settings.findOne({ where: { key } });
    if (row) { row.value = value; await this.settings.save(row); }
    else await this.settings.save(this.settings.create({ key, value }));
    return value;
  }

  invoiceProfile() { return this.get<InvoiceProfile>('invoiceProfile', DEFAULT_INVOICE_PROFILE); }
  notifications() { return this.get<NotificationSettings>('notifications', DEFAULT_NOTIFICATIONS); }
}
