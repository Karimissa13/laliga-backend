import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Payment-gateway boundary.
 *
 * The academy has not yet chosen a provider (UAE options: Telr, Network
 * International, PayTabs, Stripe), so this ships as a documented interface with
 * a mock driver. Wiring a real provider means implementing `PaymentGatewayDriver`
 * and registering it here — no other module changes.
 *
 * REQUIRED CONFIG when a provider is chosen:
 *   PAYMENT_PROVIDER=telr|network|paytabs|stripe
 *   PAYMENT_API_KEY=...
 *   PAYMENT_MERCHANT_ID=...
 *   PAYMENT_WEBHOOK_SECRET=...   (used to verify webhook signatures)
 *   PAYMENT_RETURN_URL=https://.../payment/complete
 */

export interface CheckoutSession {
  gatewayId: string;
  paymentUrl: string;
  expiresAt: Date;
  provider: string;
}

export interface GatewayEvent {
  gatewayId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: 'PAID' | 'FAILED' | 'PENDING';
  raw?: Record<string, any>;
}

export interface PaymentGatewayDriver {
  readonly name: string;
  createCheckout(params: { invoiceId: string; invoiceNumber: string; amount: number; currency: string; customerEmail?: string }): Promise<CheckoutSession>;
  verifyWebhook(signature: string | undefined, payload: any): boolean;
  parseWebhook(payload: any): GatewayEvent;
}

/** Deterministic mock so the whole payment flow is testable before credentials exist. */
class MockGatewayDriver implements PaymentGatewayDriver {
  readonly name = 'mock';
  async createCheckout(params: { invoiceId: string; invoiceNumber: string; amount: number; currency: string }): Promise<CheckoutSession> {
    const gatewayId = `mock_${params.invoiceNumber}_${Math.round(params.amount * 100)}`;
    return {
      gatewayId,
      paymentUrl: `https://payments.example.test/checkout/${gatewayId}`,
      expiresAt: new Date(Date.now() + 3600_000),
      provider: this.name,
    };
  }
  verifyWebhook(): boolean { return true; } // mock accepts everything
  parseWebhook(payload: any): GatewayEvent {
    return {
      gatewayId: payload.gatewayId ?? payload.id,
      invoiceId: payload.invoiceId,
      amount: Number(payload.amount ?? 0),
      currency: payload.currency ?? 'AED',
      status: payload.status ?? 'PAID',
      raw: payload,
    };
  }
}

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger('PaymentGateway');
  private readonly driver: PaymentGatewayDriver;

  constructor(private readonly config: ConfigService) {
    const provider = this.config.get<string>('PAYMENT_PROVIDER') || 'mock';
    // Register real drivers here as they are implemented.
    switch (provider) {
      case 'mock':
      default:
        this.driver = new MockGatewayDriver();
        if (provider !== 'mock') {
          this.logger.warn(`Payment provider "${provider}" not implemented yet — falling back to mock driver.`);
        }
    }
  }

  get providerName() { return this.driver.name; }
  get isLive() { return this.driver.name !== 'mock'; }

  createCheckout(params: { invoiceId: string; invoiceNumber: string; amount: number; currency?: string; customerEmail?: string }) {
    return this.driver.createCheckout({ currency: 'AED', ...params });
  }
  verifyWebhook(signature: string | undefined, payload: any) { return this.driver.verifyWebhook(signature, payload); }
  parseWebhook(payload: any) { return this.driver.parseWebhook(payload); }
}
