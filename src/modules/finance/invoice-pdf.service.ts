import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CreditNote, Enrolment, Invoice, Payment, RevenueStream } from '../../database/entities';
import { Proration, ProrationService } from './proration.service';
import { SettingsService } from './settings.service';
import { PACKAGE_LABEL, hoursPerSession, defaultSessionsPerWeek } from './pricing';

const C = {
  ink: '#2b2826', red: '#e8264b', grey: '#cfcfcf', band: '#d9d9d9', text: '#222222', muted: '#555555', white: '#ffffff',
};
const DAY = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' } as Record<string, string>;
const LEVEL_SHORT: Record<string, string> = { DEVELOPMENT: 'Dev', ADVANCED: 'Adv', HPC: 'HPC' };

const n2 = (v: number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (d?: string | Date | null) => {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d) : d;
  return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });
};
const isoDate = (d?: string | Date | null) => {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d) : d;
  return x.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
};
const t12 = (t?: string | null) => (t ? t.slice(0, 5) : '');

/**
 * public/brand/logo-on-dark.png (red + white LaLiga Academy Abu Dhabi artwork), read once.
 * public/ ships with the Vercel function (vercel.json includeFiles) and sits at the project root locally.
 */
let LOGO: Buffer | null | undefined;
export function brandLogo(): Buffer | null {
  if (LOGO !== undefined) return LOGO;
  const candidates = [join(__dirname, '..', '..', '..', 'public', 'brand', 'logo-on-dark.png'), join(process.cwd(), 'public', 'brand', 'logo-on-dark.png')];
  LOGO = null;
  for (const p of candidates) { try { LOGO = readFileSync(p); break; } catch { /* try the next location */ } }
  return LOGO;
}

/**
 * The tax invoice as a PDF, laid out like the academy's existing invoice:
 * dark header, bill-to block, description table with the player's programme
 * details, extras, discounts, bank details and totals, then the terms page.
 * Built from the invoice record every time — nothing is stored.
 */
@Injectable()
export class InvoicePdfService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(CreditNote) private readonly creditNotes: Repository<CreditNote>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly settings: SettingsService,
    private readonly proration: ProrationService,
  ) {}

  fileName(number: string) { return `Invoice-${number}.pdf`; }

  async render(invoiceId: string): Promise<{ buffer: Buffer; fileName: string; number: string }> {
    const inv = await this.invoices.findOne({
      where: { id: invoiceId },
      relations: { guardian: true, lineItems: { player: { ageGroup: true } }, discounts: true, payments: true },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const enrols = await this.enrolments.find({
      where: { invoiceId: inv.id }, relations: { term: true, season: true, team: true, player: true },
    });
    const profile = await this.settings.invoiceProfile();
    // Children who start after the first day: their prorated sessions, worked out before drawing.
    const prorated = new Map<string, Proration>();
    for (const pid of [...new Set(enrols.map((e) => e.playerId))]) {
      const mine = enrols.filter((e) => e.playerId === pid);
      const start = mine.map((e) => e.startDate).filter(Boolean).sort()[0];
      if (!start) continue;
      try {
        const pr = await this.proration.forPurchase(mine.map((e) => e.term).filter(Boolean), mine.find((e) => e.team)?.team ?? null, start);
        if (pr) prorated.set(pid, pr);
      } catch { /* a start date that no longer fits is shown as typed, without the session count */ }
    }

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Tax invoice ${inv.number}`, Author: profile.companyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

    const W = 595.28, M = 40, CW = W - 2 * M;
    const col = { desc: M, qty: M + 262, unit: M + 318, total: M + 400, end: W - M };

    this.header(doc, 'TAX INVOICE', W, M);

    // ---- bill to + date/number ---------------------------------------------
    const g = inv.guardian;
    doc.fillColor(C.text).font('Helvetica').fontSize(9.5);
    let y = 100;
    doc.text('To', M + 8, y); y += 18;
    doc.font('Helvetica-Bold').text(g?.fullName ?? '', M + 8, y); y += 16;
    doc.font('Helvetica').text(`Email ID: ${g?.email ?? ''}`, M + 8, y); y += 16;
    doc.text(`Phone: ${g?.mobile ?? ''}`, M + 8, y); y += 16;
    doc.text(`Parent No: ${g?.reference ?? ''}`, M + 8, y);
    const bx = W - 200;
    const box = (yy: number, k: string, v: string) => {
      doc.rect(bx, yy, 48, 20).fill(C.grey); doc.rect(bx + 48, yy, 112, 20).fill('#e6e6e6');
      doc.fillColor(C.text).font('Helvetica').fontSize(9).text(k, bx + 6, yy + 6).text(v, bx + 54, yy + 6, { width: 104 });
    };
    box(122, 'Date:', isoDate(inv.issueDate));
    box(146, 'Invoice:', inv.number);
    if (inv.dueDate) box(170, 'Due:', isoDate(inv.dueDate));

    // ---- table header ---------------------------------------------------------
    y = 205;
    doc.rect(M, y, CW, 20).fill(C.grey);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8.5)
      .text('Description', col.desc + 6, y + 6)
      .text('Quantity', col.qty, y + 6, { width: 50, align: 'center' })
      .text('Unit Price', col.unit, y + 6, { width: 76, align: 'right' })
      .text('Total Amount', col.total, y + 6, { width: col.end - col.total - 6, align: 'right' });
    y += 28;

    const money = (yy: number, qty: number, unit: number, total: number) => {
      doc.font('Helvetica').fontSize(9).fillColor(C.text)
        .text(String(qty), col.qty, yy, { width: 50, align: 'center' })
        .text(unit < 0 ? `- ${n2(-unit)}` : n2(unit), col.unit, yy, { width: 76, align: 'right' })
        .text(total < 0 ? `- ${n2(-total)}` : n2(total), col.total, yy, { width: col.end - col.total - 6, align: 'right' });
    };
    const pageBreak = (need: number) => {
      if (y + need > 640) { this.footer(doc, profile, W); doc.addPage({ size: 'A4', margin: 0 }); y = 50; }
    };

    const fees = inv.lineItems.filter((l) => l.stream === RevenueStream.ACADEMY)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const extras = inv.lineItems.filter((l) => l.stream !== RevenueStream.ACADEMY)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const line of fees) {
      const player = line.player;
      const mine = enrols.filter((e) => e.playerId === line.playerId)
        .sort((a, b) => String(a.term?.startDate).localeCompare(String(b.term?.startDate)));
      const rows: Array<[string, string]> = [];
      if (player && mine.length) {
        const team = mine.find((e) => e.team)?.team ?? null;
        const season = mine[0].season?.name ?? '';
        const termNums = mine.map((e) => (e.term?.name ?? '').replace(/^Term\s*/i, '')).join(',');
        const first = mine[0].term, last = mine[mine.length - 1].term;
        const weeks = mine.reduce((s, e) => s + (e.term?.weeks ?? 0), 0);
        const spw = mine[0].sessionsPerWeek ?? defaultSessionsPerWeek(team);
        const pr = line.playerId ? prorated.get(line.playerId) : undefined;
        const typed = mine.map((e) => e.startDate).filter(Boolean).sort()[0];
        const start = typed && first?.startDate && typed > first.startDate ? typed : (first?.startDate ?? '');
        const cat = player.ageGroup?.code ?? team?.ageCodes?.[0] ?? '';
        rows.push(['Player', `${player.firstName} ${player.lastName} (${player.reference})`]);
        rows.push(['Academy', profile.academyName]);
        rows.push(['Terms', `${season} Term ${termNums} - ${longDate(first?.startDate)} - ${longDate(last?.endDate)}`]);
        if (line.package) rows.push(['Option', PACKAGE_LABEL[line.package as keyof typeof PACKAGE_LABEL] ?? line.package]);
        rows.push(['Age Category', cat.replace(/^U/, 'U-')]);
        if (team) rows.push(['Team', team.name]);
        if (weeks) rows.push(['Training Weeks', String(weeks)]);
        rows.push(['Start Date', isoDate(start)]);
        if (weeks) rows.push(['No of Sessions', pr ? `${Math.max(1, Math.round(weeks * spw * pr.ratio))} of ${weeks * spw} (prorated from the start date)` : String(weeks * spw)]);
        if (team?.trainingDays?.length) {
          const lvl = LEVEL_SHORT[team.level] ?? team.level;
          rows.push(['Classes', team.trainingDays.map((d) => `${cat.replace(/^U/, 'U-')} ${lvl} ${DAY[d] ?? d} ${t12(team.startTime)} to ${t12(team.endTime)}`).join('\n')]);
        }
        rows.push(['Sessions', `${spw} a week · ${hoursPerSession(cat) === 1 ? '1 hour' : '1½ hours'} each`]);
      } else {
        rows.push(['Description', line.description]);
      }
      const h = rows.reduce((s, [, v]) => s + 14 * v.split('\n').length + (v.length > 46 ? 14 : 0), 0);
      pageBreak(h + 10);
      const top = y;
      for (const [k, v] of rows) {
        doc.font('Helvetica').fontSize(9).fillColor(C.text).text(k, col.desc + 6, y, { width: 92 });
        doc.text(':', col.desc + 100, y);
        doc.text(v, col.desc + 108, y, { width: col.qty - col.desc - 116, lineGap: 2 });
        y = doc.y + 3;
      }
      money(top + (y - top) / 2 - 6, 1, Number(line.unitAmount), Number(line.unitAmount));
      y += 6;
      // the child's discount, as its own line
      for (const d of inv.discounts.filter((x) => x.playerId === line.playerId)) {
        pageBreak(20);
        const who = player ? `${player.firstName} ${player.lastName}: ` : '';
        doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`${who}${d.label}`, col.desc + 6, y, { width: col.qty - col.desc - 12 });
        money(y, 1, -Number(d.amount), -Number(d.amount));
        y += 22;
      }
    }
    for (const line of extras) {
      pageBreak(22);
      const desc = line.description.replace(/^.*? — /, '');
      const who = line.player ? ` (${line.player.firstName})` : '';
      doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`${desc}${who}`, col.desc + 6, y, { width: col.qty - col.desc - 12 });
      money(y, line.quantity, Number(line.lineTotal) / Math.max(1, line.quantity), Number(line.lineTotal));
      y += 22;
    }
    // invoice-level discounts (not tied to a child)
    for (const d of inv.discounts.filter((x) => !x.playerId)) {
      pageBreak(22);
      doc.font('Helvetica').fontSize(9).text(d.label, col.desc + 6, y);
      money(y, 1, -Number(d.amount), -Number(d.amount));
      y += 22;
    }

    // ---- payment details + totals band ----------------------------------------
    const bandH = 215;
    y = Math.max(y + 16, 470);
    if (y + bandH > 795) { this.footer(doc, profile, W); doc.addPage({ size: 'A4', margin: 0 }); y = 60; }
    doc.rect(0, y, W, bandH).fill(C.band);
    const b = profile.bank;
    const left: string[] = [
      `Payment terms: ${profile.paymentTerms}`,
      'Cash / Check in favor of:',
      profile.chequePayee,
      `Bank Name: ${b.bankName}`,
      `Account Name: ${b.accountName}`,
      `Branch Name: ${b.branch}`,
      `SWIFT Code: ${b.swift}`,
      `AED Account Number: ${b.accountNumber}`,
      `AED IBAN Number: ${b.iban}`,
    ];
    let ly = y + 20;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.text);
    for (const t of left) { doc.text(t, M + 8, ly, { width: 300 }); ly = doc.y + 6; }

    const paid = Number(inv.amountPaid) - Number(inv.amountRefunded);
    const balance = Math.max(0, Number(inv.total) - paid - Number(inv.writeOffAmount));
    const totals: Array<[string, string]> = [
      ['Sub Total', n2(Number(inv.subtotal))],
      ['VAT Amount', n2(Number(inv.vatTotal))],
      ['Total', n2(Number(inv.total))],
    ];
    if (paid > 0.004) totals.push(['Paid', n2(paid)]);
    if (paid > 0.004 || Number(inv.writeOffAmount) > 0) totals.push(['Balance Due', n2(balance)]);
    let ty = y + 50;
    for (const [k, v] of totals) {
      doc.rect(W - 225, ty, 95, 22).fill(C.ink);
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text(k, W - 218, ty + 7);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(v, W - 125, ty + 6, { width: 85, align: 'right' });
      ty += 28;
    }
    this.footer(doc, profile, W);

    // ---- terms page -----------------------------------------------------------
    doc.addPage({ size: 'A4', margin: 0 });
    let py = 50;
    doc.font('Helvetica').fontSize(9).fillColor(C.text);
    for (const t of profile.terms) {
      doc.circle(M + 14, py + 4, 1.6).fill(C.text);
      doc.fillColor(C.text).text(t, M + 22, py, { width: CW - 40, lineGap: 2 });
      py = doc.y + 5;
    }
    this.footer(doc, profile, W);

    doc.end();
    return { buffer: await done, fileName: this.fileName(inv.number), number: inv.number };
  }

  /** Dark title band with the academy logo (the on-dark artwork), as on the academy's printed invoice. */
  private header(doc: PDFKit.PDFDocument, title: string, W: number, M: number) {
    doc.rect(0, 30, W, 48).fill(C.ink);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(title.length > 12 ? 22 : 26).text(title, M - 16, title.length > 12 ? 43 : 41);
    doc.rect(W - 205, 32, 168, 44).fill('#1c1a19');
    const logo = brandLogo();
    if (logo) {
      doc.image(logo, W - 197, 36, { fit: [152, 36], align: 'center', valign: 'center' });
    } else {
      // Artwork missing from the deployment: draw the wordmark instead of failing the document.
      doc.font('Helvetica-Bold').fontSize(17).fillColor(C.red).text('LALIGA', W - 195, 38, { continued: true })
        .fillColor(C.white).font('Helvetica').text(' ACADEMY');
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.red).text('ABU DHABI', W - 205, 59, { width: 168, align: 'center', characterSpacing: 1 });
    }
  }

  private footer(doc: PDFKit.PDFDocument, profile: { companyName: string; addressLine: string; trn: string }, W: number) {
    doc.rect(0, 800, W, 42).fill(C.ink);
    doc.fillColor(C.white).font('Helvetica').fontSize(8)
      .text(`${profile.companyName}, ${profile.addressLine}, TRN # ${profile.trn}`, 60, 812, { width: W - 120, align: 'center', lineGap: 2 });
  }

  /**
   * The tax credit note, in the invoice's layout: what is credited, against which
   * tax invoice, why, and the VAT it reverses.
   */
  async renderCreditNote(id: string): Promise<{ buffer: Buffer; fileName: string; number: string }> {
    const n = await this.creditNotes.findOne({ where: { id }, relations: { invoice: true, guardian: true } });
    if (!n) throw new NotFoundException('Credit note not found');
    const profile = await this.settings.invoiceProfile();
    const refund = n.paymentId ? await this.payments.findOne({ where: { id: n.paymentId } }) : null;

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Tax credit note ${n.number}`, Author: profile.companyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
    const W = 595.28, M = 40, CW = W - 2 * M;
    const col = { desc: M, qty: M + 262, unit: M + 318, total: M + 400, end: W - M };

    this.header(doc, 'TAX CREDIT NOTE', W, M);
    const g = n.guardian;
    doc.fillColor(C.text).font('Helvetica').fontSize(9.5);
    let y = 100;
    doc.text('To', M + 8, y); y += 18;
    doc.font('Helvetica-Bold').text(g?.fullName ?? '', M + 8, y); y += 16;
    doc.font('Helvetica').text(`Email ID: ${g?.email ?? ''}`, M + 8, y); y += 16;
    doc.text(`Phone: ${g?.mobile ?? ''}`, M + 8, y); y += 16;
    doc.text(`Parent No: ${g?.reference ?? ''}`, M + 8, y);
    const bx = W - 230;
    const box = (yy: number, k: string, v: string) => {
      doc.rect(bx, yy, 78, 20).fill(C.grey); doc.rect(bx + 78, yy, 112, 20).fill('#e6e6e6');
      doc.fillColor(C.text).font('Helvetica').fontSize(9).text(k, bx + 6, yy + 6).text(v, bx + 84, yy + 6, { width: 104 });
    };
    box(122, 'Date:', isoDate(n.issueDate));
    box(146, 'Credit note:', n.number);
    box(170, 'Tax invoice:', n.invoice?.number ?? '');
    box(194, 'Invoice date:', isoDate(n.invoice?.issueDate));

    y = 232;
    doc.rect(M, y, CW, 20).fill(C.grey);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8.5)
      .text('Description', col.desc + 6, y + 6)
      .text('Quantity', col.qty, y + 6, { width: 50, align: 'center' })
      .text('Unit Price', col.unit, y + 6, { width: 76, align: 'right' })
      .text('Total Amount', col.total, y + 6, { width: col.end - col.total - 6, align: 'right' });
    y += 30;
    const KIND: Record<string, string> = { REFUND: 'Refund', WRITE_OFF: 'Amount forgiven', CANCELLATION: 'Invoice cancelled' };
    const lines = [
      `${KIND[n.kind] ?? n.kind} against tax invoice ${n.invoice?.number ?? ''} dated ${isoDate(n.invoice?.issueDate)}`,
      `Reason: ${n.reason}`,
    ];
    if (refund) lines.push(refund.method === 'WALLET' ? 'Credited to the family wallet, for future invoices' : 'Paid back to the parent');
    const top = y;
    doc.font('Helvetica').fontSize(9).fillColor(C.text);
    for (const t of lines) { doc.text(t, col.desc + 6, y, { width: col.qty - col.desc - 16, lineGap: 2 }); y = doc.y + 4; }
    const net = Number(n.netAmount);
    doc.text('1', col.qty, top, { width: 50, align: 'center' })
      .text(`- ${n2(net)}`, col.unit, top, { width: 76, align: 'right' })
      .text(`- ${n2(net)}`, col.total, top, { width: col.end - col.total - 6, align: 'right' });

    const bandY = Math.max(y + 24, 400), bandH = 150;
    doc.rect(0, bandY, W, bandH).fill(C.band);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
      .text('This credit note reduces the tax invoice above by the amount shown, including the VAT charged on it.', M + 8, bandY + 22, { width: 300, lineGap: 2 })
      .text(`TRN: ${profile.trn}`, M + 8, doc.y + 8, { width: 300 });
    let ty = bandY + 28;
    for (const [k, v] of [['Sub Total', `- ${n2(net)}`], ['VAT Amount', `- ${n2(Number(n.vatAmount))}`], ['Total Credit', `- ${n2(Number(n.total))}`]]) {
      doc.rect(W - 225, ty, 95, 22).fill(C.ink);
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text(k, W - 218, ty + 7);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(v, W - 125, ty + 6, { width: 85, align: 'right' });
      ty += 28;
    }
    this.footer(doc, profile, W);
    doc.end();
    return { buffer: await done, fileName: `Credit-Note-${n.number}.pdf`, number: n.number };
  }

  /** Several invoices at once (e.g. for a family) — returns them in order. */
  async renderMany(ids: string[]) {
    const found = await this.invoices.find({ where: { id: In(ids) }, select: { id: true } });
    return Promise.all(found.map((f) => this.render(f.id)));
  }
}
