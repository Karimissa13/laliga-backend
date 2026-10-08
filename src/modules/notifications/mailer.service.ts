import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}
export interface MailResult { ok: boolean; simulated: boolean; messageId?: string; error?: string }

/**
 * Sends email through any SMTP mailbox (Microsoft 365, Google Workspace,
 * SendGrid, Amazon SES …). Connection details come from the server's .env —
 * the academy enters them there; they are never stored in the database:
 *
 *   MAIL_HOST, MAIL_PORT (587), MAIL_SECURE (false for 587, true for 465),
 *   MAIL_USER, MAIL_PASS, MAIL_FROM (e.g. accounts@laligaacademyabudhabi.com)
 *
 * Until MAIL_HOST is set, nothing leaves the server: every message is recorded
 * in the email log as "not sent — email not connected" so it can be checked.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('Mailer');
  private transport: nodemailer.Transporter | null = null;

  get live(): boolean { return !!process.env.MAIL_HOST; }

  status() {
    return {
      connected: this.live,
      host: process.env.MAIL_HOST ? process.env.MAIL_HOST.replace(/^(.{3}).*(\..*)$/, '$1…$2') : null,
      from: process.env.MAIL_FROM ?? null,
    };
  }

  private getTransport() {
    if (!this.transport) {
      this.transport = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT ?? 587),
        secure: process.env.MAIL_SECURE === 'true',
        auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
      });
    }
    return this.transport;
  }

  async send(m: MailMessage): Promise<MailResult> {
    if (!this.live) {
      this.logger.log(`[not connected] ${m.subject} → ${m.to}${m.attachments?.length ? ` (+${m.attachments.length} attachment)` : ''}`);
      return { ok: true, simulated: true };
    }
    try {
      const from = process.env.MAIL_FROM ?? process.env.MAIL_USER ?? '';
      const info = await this.getTransport().sendMail({
        from: m.fromName ? `"${m.fromName.replace(/"/g, '')}" <${from}>` : from,
        to: m.to, cc: m.cc?.length ? m.cc : undefined,
        replyTo: m.replyTo || undefined,
        subject: m.subject, html: m.html, text: m.text,
        attachments: m.attachments,
      });
      return { ok: true, simulated: false, messageId: info.messageId };
    } catch (e) {
      this.logger.error(`Send failed to ${m.to}: ${(e as Error).message}`);
      return { ok: false, simulated: false, error: (e as Error).message.slice(0, 300) };
    }
  }
}
