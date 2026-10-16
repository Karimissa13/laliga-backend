/**
 * "Forgot password" email for the parent portal, in the same design as the payment
 * reminder (logo on the dark band, red line, red button). The link carries a one-time
 * code; it is never written to the email log (see `redactResetLink`).
 */
import { LOGO_CID } from './reminder-email';

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const C = { ink: '#2b2826', red: '#e8264b', page: '#f3f2f4', card: '#f6f5f7', line: '#e6e3e8', text: '#222222', muted: '#6a6772' };
const P = (t: string, extra = '') => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${C.text};${extra}">${t}</p>`;

export interface ResetFacts {
  parentName: string; email: string; link: string; minutes: number;
  academyName: string; companyName: string; replyTo?: string | null;
}

export function passwordResetEmail(f: ResetFacts, logoSrc = `cid:${LOGO_CID}`) {
  const subject = 'Choose a new password — LaLiga Academy parent account';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:Arial,Helvetica,sans-serif;color:${C.text};-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td style="background:${C.ink};padding:22px 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${esc(logoSrc)}" width="170" height="47" alt="LaLiga Academy Abu Dhabi" style="display:block;width:170px;height:47px;border:0;outline:none;text-decoration:none"></td>
      <td align="right" style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#ffffff;text-transform:uppercase">Your account</td>
    </tr></table></td></tr>
  <tr><td style="height:4px;background:${C.red};font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 8px">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${C.ink}">Choose a new password</h1>
    ${P(`Dear ${esc(f.parentName)},`)}
    ${P(`We received a request to reset the password of your parent account (<b>${esc(f.email)}</b>). Use the button below to choose a new one.`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 10px"><tr><td style="background:${C.red};border-radius:8px">
      <a href="${esc(f.link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">Choose a new password</a></td></tr></table>
    ${P(`The link works once and for ${f.minutes} minutes. After that, you can ask for a new one from the sign-in page.`, `font-size:13px;color:${C.muted}`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border-radius:8px;margin:14px 0 6px">
      <tr><td style="padding:14px 16px;font-size:12.5px;line-height:1.6;color:${C.text}">
        <b>Didn't ask for this?</b> You can ignore this email — your password stays the same. The academy will never ask you for your password.
      </td></tr></table>
    ${P(`Kind regards,<br><b>${esc(f.academyName)} Abu Dhabi</b>`, 'margin-top:16px')}
  </td></tr>
  <tr><td style="padding:16px 28px 22px;border-top:1px solid ${C.line};font-size:11px;line-height:1.6;color:#888">
    ${esc(f.companyName)}${f.replyTo ? ` · Questions? Reply to this email or write to ${esc(f.replyTo)}` : ''}<br>
    If the button doesn't work, copy this address into your browser: <span style="word-break:break-all">${esc(f.link)}</span></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Dear ${f.parentName},`, '',
    `We received a request to reset the password of your parent account (${f.email}).`,
    'Choose a new password here:', f.link, '',
    `The link works once and for ${f.minutes} minutes.`, '',
    "Didn't ask for this? You can ignore this email — your password stays the same. The academy will never ask you for your password.", '',
    'Kind regards,', `${f.academyName} Abu Dhabi`,
  ].join('\n');
  return { subject, html, text };
}

/** The log keeps the email without the one-time code. */
export function redactResetLink(s: string, token: string) { return s.split(token).join('••••••••'); }
