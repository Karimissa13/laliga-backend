/** Branded HTML emails. Every value is escaped; layout is table-based for mail clients. */

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function layout(title: string, body: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f3f2f4;font-family:Arial,Helvetica,sans-serif;color:#222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2f4;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#2b2826;padding:18px 24px"><span style="font-size:20px;font-weight:bold;color:#e8264b;letter-spacing:.5px">LALIGA</span><span style="font-size:20px;color:#ffffff"> ACADEMY</span><div style="font-size:11px;font-weight:bold;color:#e8264b;letter-spacing:2px">ABU DHABI</div></td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 14px;font-size:20px;color:#1a191f">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:11px;color:#777;border-top:1px solid #eee">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (t: string) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${t}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="background:#e8264b;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:7px;display:inline-block">${esc(label)}</a></p>`;

export function welcomeEmail(v: {
  parentName: string; childName: string; email: string; tempPassword?: string; portalUrl: string;
  expiresOn?: string; company: string;
}) {
  const creds = v.tempPassword
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f6f5f7;border-radius:8px;margin:6px 0 14px"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.7">
        Sign-in email: <b>${esc(v.email)}</b><br>Temporary password: <b style="font-family:Consolas,monospace;font-size:15px">${esc(v.tempPassword)}</b></td></tr></table>
      ${p(`You'll be asked to choose your own password the first time you sign in.${v.expiresOn ? ` The temporary password works until <b>${esc(v.expiresOn)}</b>.` : ''}`)}`
    : p('You can see their registration and invoices when you sign in with your existing password.');
  const html = layout(`Welcome to LaLiga Academy Abu Dhabi`,
    p(`Dear ${esc(v.parentName)},`) +
    p(`<b>${esc(v.childName)}</b> ${/ and /.test(v.childName) ? 'are' : 'is'} now registered with LaLiga Academy Abu Dhabi. We're delighted to have you with us.`) +
    (v.tempPassword ? p('Your parent account has been created. Use these details to sign in:') : '') +
    creds + button(v.portalUrl, 'Sign in to your account') +
    p('If you did not expect this email, please contact the academy.'),
    `${esc(v.company)}`);
  const text = `Dear ${v.parentName},\n\n${v.childName} ${/ and /.test(v.childName) ? 'are' : 'is'} now registered with LaLiga Academy Abu Dhabi.\n\n` +
    (v.tempPassword ? `Sign-in email: ${v.email}\nTemporary password: ${v.tempPassword}\nYou'll be asked to choose your own password the first time you sign in.\n\n` : '') +
    `Sign in: ${v.portalUrl}\n\n${v.company}`;
  return { subject: v.tempPassword ? 'Welcome to LaLiga Academy — your sign-in details' : `${v.childName} ${/ and /.test(v.childName) ? 'are' : 'is'} registered at LaLiga Academy`, html, text };
}

export function invoiceEmail(v: {
  parentName: string; number: string; total: string; balance: string; dueDate?: string | null; players: string;
  portalUrl: string; company: string; bankLine: string;
}) {
  const html = layout(`Tax invoice ${v.number}`,
    p(`Dear ${esc(v.parentName)},`) +
    p(`Please find attached tax invoice <b>${esc(v.number)}</b>${v.players ? ` for <b>${esc(v.players)}</b>` : ''}.`) +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f6f5f7;border-radius:8px;margin:6px 0 14px;width:100%"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8">
      Total: <b>AED ${esc(v.total)}</b><br>Amount due: <b>AED ${esc(v.balance)}</b>${v.dueDate ? `<br>Due by: <b>${esc(v.dueDate)}</b>` : ''}</td></tr></table>` +
    p('Places are only guaranteed once the invoice is paid.') +
    p(`<span style="font-size:12.5px;color:#555">${esc(v.bankLine)}</span>`) +
    button(v.portalUrl, 'View in your account'),
    esc(v.company));
  const text = `Dear ${v.parentName},\n\nPlease find attached tax invoice ${v.number}${v.players ? ` for ${v.players}` : ''}.\n` +
    `Total: AED ${v.total}\nAmount due: AED ${v.balance}${v.dueDate ? `\nDue by: ${v.dueDate}` : ''}\n\n${v.bankLine}\n\n${v.portalUrl}\n\n${v.company}`;
  return { subject: `LaLiga Academy — tax invoice ${v.number}`, html, text };
}

/** A link to pay the invoice (or one instalment) online; a reminder when it is past due. */
export function paymentLinkEmail(v: {
  parentName: string; number: string; amount: string; what: string; dueDate?: string | null; overdue: boolean;
  players: string; url: string; company: string; bankLine: string; online: boolean;
}) {
  const title = v.overdue ? `Payment reminder — ${v.number}` : `Payment link — ${v.number}`;
  const html = layout(title,
    p(`Dear ${esc(v.parentName)},`) +
    p(v.overdue
      ? `This is a friendly reminder that <b>${esc(v.what)}</b> of invoice <b>${esc(v.number)}</b>${v.players ? ` for <b>${esc(v.players)}</b>` : ''} is now due.`
      : `Here is your payment link for <b>${esc(v.what)}</b> of invoice <b>${esc(v.number)}</b>${v.players ? ` for <b>${esc(v.players)}</b>` : ''}.`) +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f6f5f7;border-radius:8px;margin:6px 0 14px;width:100%"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8">
      Amount to pay: <b>AED ${esc(v.amount)}</b>${v.dueDate ? `<br>Due by: <b>${esc(v.dueDate)}</b>` : ''}</td></tr></table>` +
    button(v.url, v.online ? 'Pay now' : 'See how to pay') +
    p(`<span style="font-size:12.5px;color:#555">${esc(v.bankLine)}</span>`) +
    p('If you have already paid, thank you — please ignore this email.'),
    esc(v.company));
  const text = `Dear ${v.parentName},\n\n` +
    (v.overdue ? `This is a friendly reminder that ${v.what} of invoice ${v.number} is now due.` : `Here is your payment link for ${v.what} of invoice ${v.number}.`) +
    `\nAmount to pay: AED ${v.amount}${v.dueDate ? `\nDue by: ${v.dueDate}` : ''}\n\n${v.online ? 'Pay now' : 'How to pay'}: ${v.url}\n\n${v.bankLine}\n\nIf you have already paid, thank you — please ignore this email.\n\n${v.company}`;
  return { subject: `LaLiga Academy — ${v.overdue ? 'payment reminder' : 'payment link'} ${v.number}`, html, text };
}
