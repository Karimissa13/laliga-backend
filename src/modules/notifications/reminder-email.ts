/**
 * The payment reminder email (Karim, Oct 2026): the invoice's look — dark band with
 * the academy logo, red accents — in a table layout that mail clients render alike.
 *
 * The logo is the 852 × 235 px artwork shown at 170 px wide, so it stays sharp on
 * phones and high-resolution screens. It travels inside the email (an inline image,
 * `cid:laliga-logo`) so it shows without the parent having to "load images"; the
 * email log and the preview use the same file from /brand/.
 */

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const LOGO_CID = 'laliga-logo';
export const LOGO_PUBLIC_PATH = '/brand/logo-on-dark.png';

export type ReminderKind = 'friendly' | 'overdue';

/** The wording staff can change in Communications → Payment reminders. Placeholders in {braces}. */
export interface ReminderWording { subject: string; heading: string; intro: string }
export const REMINDER_PLACEHOLDERS = ['{parent}', '{children}', '{invoice}', '{amount}', '{dueDate}', '{days}', '{what}'];
export const DEFAULT_REMINDER_WORDING: Record<ReminderKind, ReminderWording> = {
  friendly: {
    subject: 'Payment reminder — invoice {invoice}',
    heading: 'Payment reminder',
    intro: 'This is a friendly reminder that a payment of {amount} for {children} is due on {dueDate}. You will find the details below.',
  },
  overdue: {
    subject: 'Payment overdue — invoice {invoice}',
    heading: 'Your payment is overdue',
    intro: 'Our records show that the payment of {amount} for {children} was due on {dueDate} and is now {days} days overdue. Please settle it at your earliest convenience so that {children} can keep training with us.',
  },
};

export interface ReminderFacts {
  kind: ReminderKind;
  parentName: string;
  children: string;
  invoiceNumber: string;
  /** "Instalment 2 of 3", "Instalments 1–2 of 3" or "Invoice balance". */
  what: string;
  amountDue: number;
  dueDate: string | null;        // YYYY-MM-DD
  daysOverdue: number;
  invoiceTotal: number;
  paidSoFar: number;
  balance: number;
  instalments: Array<{ seq: number; dueDate: string; amount: number; remaining: number; state: string }>;
  portalUrl: string;
  bank: { accountName: string; bankName: string; iban: string; accountNumber?: string; swift?: string };
  academyName: string;
  companyName: string;
  replyTo?: string | null;
}

const aed = (n: number) => 'AED ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d?: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');

/** Fill the {placeholders} of a wording line. */
export function fillWording(t: string, f: ReminderFacts) {
  const v: Record<string, string> = {
    parent: f.parentName, children: f.children || 'your child', invoice: f.invoiceNumber, amount: aed(f.amountDue),
    dueDate: dmy(f.dueDate), days: String(f.daysOverdue), what: f.what,
  };
  return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}

const C = { ink: '#2b2826', red: '#e8264b', page: '#f3f2f4', card: '#f6f5f7', line: '#e6e3e8', text: '#222222', muted: '#6a6772', good: '#1f8a4c' };
const P = (t: string, extra = '') => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${C.text};${extra}">${t}</p>`;

/**
 * Subject, HTML and plain text of a reminder. `logoSrc` is `cid:laliga-logo` for the
 * email itself and the public path for previews and the log.
 */
export function paymentReminderEmail(f: ReminderFacts, wording: ReminderWording, logoSrc = `cid:${LOGO_CID}`) {
  const overdue = f.kind === 'overdue';
  const subject = fillWording(wording.subject, f);
  const heading = fillWording(wording.heading, f);
  const intro = fillWording(wording.intro, f);
  const row = (k: string, v: string, strong = false, color = C.text) =>
    `<tr><td style="padding:7px 0;font-size:13px;color:${C.muted};border-bottom:1px solid ${C.line}">${esc(k)}</td>
      <td align="right" style="padding:7px 0;font-size:${strong ? 15 : 13}px;font-weight:${strong ? 'bold' : 'normal'};color:${color};border-bottom:1px solid ${C.line}">${v}</td></tr>`;
  const stateWord: Record<string, string> = { PAID: 'Paid', WAIVED: 'Waived', PART_PAID: 'Part paid', OVERDUE: 'Overdue', READY: 'Due', DUE: 'Due today', UPCOMING: 'Upcoming' };
  const stateColor = (s: string) => (s === 'PAID' || s === 'WAIVED' ? C.good : s === 'OVERDUE' ? C.red : C.muted);
  const plan = f.instalments.length ? `
    <p style="margin:18px 0 6px;font-size:12px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:${C.muted}">Instalments</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${f.instalments.map((i) => `<tr>
        <td style="padding:6px 0;font-size:13px;border-bottom:1px solid ${C.line}">Instalment ${i.seq}</td>
        <td style="padding:6px 0;font-size:13px;color:${C.muted};border-bottom:1px solid ${C.line}">${esc(dmy(i.dueDate))}</td>
        <td align="right" style="padding:6px 0;font-size:13px;border-bottom:1px solid ${C.line}">${esc(aed(i.amount))}</td>
        <td align="right" style="padding:6px 0 6px 10px;font-size:12px;font-weight:bold;color:${stateColor(i.state)};border-bottom:1px solid ${C.line}">${esc(stateWord[i.state] || i.state)}</td></tr>`).join('')}
    </table>` : '';
  const bank = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border-radius:8px;margin:16px 0 4px">
      <tr><td style="padding:14px 16px;font-size:12.5px;line-height:1.7;color:${C.text}">
        <b style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${C.muted}">Pay by bank transfer</b><br>
        ${esc(f.bank.accountName)}<br>${esc(f.bank.bankName)} · IBAN <b>${esc(f.bank.iban)}</b>${f.bank.swift ? ` · SWIFT ${esc(f.bank.swift)}` : ''}<br>
        <span style="color:${C.muted}">Please write “${esc(f.academyName)} – ${esc(f.children || 'Name of Player')}” as the payment details and send us the transfer confirmation.</span>
      </td></tr></table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:Arial,Helvetica,sans-serif;color:${C.text};-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td style="background:${C.ink};padding:22px 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${esc(logoSrc)}" width="170" height="47" alt="LaLiga Academy Abu Dhabi" style="display:block;width:170px;height:47px;border:0;outline:none;text-decoration:none"></td>
      <td align="right" style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:${overdue ? C.red : '#ffffff'};text-transform:uppercase">${overdue ? 'Overdue' : 'Reminder'}</td>
    </tr></table></td></tr>
  <tr><td style="height:4px;background:${C.red};font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 8px">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${C.ink}">${esc(heading)}</h1>
    ${P(`Dear ${esc(f.parentName)},`)}
    ${P(esc(intro))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border-radius:10px;margin:8px 0 6px;border-left:4px solid ${overdue ? C.red : C.ink}">
      <tr><td style="padding:16px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          ${row('Invoice', `<b>${esc(f.invoiceNumber)}</b>`)}
          ${f.children ? row('For', esc(f.children)) : ''}
          ${row('Payment', esc(f.what))}
          ${row('Due date', esc(dmy(f.dueDate)) + (overdue && f.daysOverdue > 0 ? ` <span style="color:${C.red}">· ${f.daysOverdue} days overdue</span>` : ''))}
          ${row('Amount due', esc(aed(f.amountDue)), true, overdue ? C.red : C.ink)}
        </table>
        <p style="margin:10px 0 0;font-size:12px;color:${C.muted}">Invoice total ${esc(aed(f.invoiceTotal))} · paid so far ${esc(aed(f.paidSoFar))} · balance ${esc(aed(f.balance))}</p>
      </td></tr></table>
    ${plan}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="background:${C.red};border-radius:8px">
      <a href="${esc(f.portalUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">View the invoice in your account</a></td></tr></table>
    ${bank}
    ${P('If you have already paid, thank you — please ignore this reminder.', 'margin-top:16px;color:' + C.muted + ';font-size:13px')}
    ${P(`Kind regards,<br><b>${esc(f.academyName)} Abu Dhabi</b>`)}
  </td></tr>
  <tr><td style="padding:16px 28px 22px;border-top:1px solid ${C.line};font-size:11px;line-height:1.6;color:#888">
    ${esc(f.companyName)}${f.replyTo ? ` · Questions? Reply to this email or write to ${esc(f.replyTo)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Dear ${f.parentName},`, '', intro, '',
    `Invoice: ${f.invoiceNumber}`, f.children ? `For: ${f.children}` : '', `Payment: ${f.what}`,
    `Due date: ${dmy(f.dueDate)}${overdue && f.daysOverdue > 0 ? ` (${f.daysOverdue} days overdue)` : ''}`, `Amount due: ${aed(f.amountDue)}`,
    `Invoice total ${aed(f.invoiceTotal)} · paid so far ${aed(f.paidSoFar)} · balance ${aed(f.balance)}`, '',
    ...(f.instalments.length ? ['Instalments:', ...f.instalments.map((i) => `  ${i.seq}. ${dmy(i.dueDate)} — ${aed(i.amount)} — ${stateWord[i.state] || i.state}`), ''] : []),
    `View the invoice: ${f.portalUrl}`, '',
    `Pay by bank transfer: ${f.bank.accountName}, ${f.bank.bankName}, IBAN ${f.bank.iban}. Please write "${f.academyName} – ${f.children || 'Name of Player'}" as the payment details.`, '',
    'If you have already paid, thank you — please ignore this reminder.', '', `Kind regards,`, `${f.academyName} Abu Dhabi`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { subject, html, text };
}
