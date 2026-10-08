import { Logger } from '@nestjs/common';
import { CommunicationChannel } from '../../database/entities';

/**
 * Channel drivers. Providers are not yet chosen/credentialed, so each channel
 * ships with a mock driver that records the send and returns success. Wiring a
 * real provider = implement ChannelDriver and register it in CHANNEL_REGISTRY.
 *
 * REQUIRED CONFIG when providers are chosen:
 *   EMAIL:    MAIL_PROVIDER=ses|sendgrid, MAIL_API_KEY, MAIL_FROM
 *   SMS:      SMS_PROVIDER=twilio|unifonic, SMS_API_KEY, SMS_SENDER_ID
 *   WHATSAPP: WA_PROVIDER=meta|twilio, WA_TOKEN, WA_PHONE_NUMBER_ID
 *             (WhatsApp requires pre-approved message templates)
 *   PUSH:     PUSH_PROVIDER=fcm, FCM_SERVER_KEY
 */

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  simulated?: boolean;
}

export interface ChannelDriver {
  readonly channel: CommunicationChannel;
  readonly name: string;
  readonly live: boolean;
  send(to: string, subject: string | undefined, body: string): Promise<SendResult>;
}

class MockDriver implements ChannelDriver {
  private readonly logger = new Logger('Comms');
  readonly live = false;
  constructor(public readonly channel: CommunicationChannel, public readonly name = 'mock') {}
  async send(to: string, subject: string | undefined, body: string): Promise<SendResult> {
    this.logger.log(`[${this.channel}] → ${to} :: ${subject ?? ''} :: ${body.slice(0, 80)}`);
    return { ok: true, providerMessageId: `mock-${Date.now()}-${Math.round(Math.random() * 1e6)}`, simulated: true };
  }
}

export const CHANNEL_REGISTRY: Record<CommunicationChannel, ChannelDriver> = {
  [CommunicationChannel.EMAIL]: new MockDriver(CommunicationChannel.EMAIL),
  [CommunicationChannel.SMS]: new MockDriver(CommunicationChannel.SMS),
  [CommunicationChannel.WHATSAPP]: new MockDriver(CommunicationChannel.WHATSAPP),
  [CommunicationChannel.PUSH]: new MockDriver(CommunicationChannel.PUSH),
};

/** Very small mustache-style renderer: {{name}} → value. */
export function renderTemplate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o: any, k: string) => (o == null ? o : o[k]), vars);
    return val == null ? '' : String(val);
  });
}
