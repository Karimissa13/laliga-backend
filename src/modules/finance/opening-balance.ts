/**
 * "Balance from earlier seasons" (Karim, 16 Oct 2026). Unpaid invoices of a current family from
 * before Season 9 are not moved one by one: the family gets ONE opening balance listing each old
 * invoice (number, date, what was invoiced and paid, what is still owed).
 *
 * It is not a new tax invoice — the old invoices were already issued with their VAT — so it adds
 * no VAT, its PDF is a statement, and season revenue reports leave it out. It is money owed like
 * any other invoice: it shows in the family balance and the parent portal, can get reminders, and
 * can be paid (cash, transfer, card, wallet) or written off.
 *
 * Pure part here (unit-tested); writing it is in OpeningBalanceService.
 */
export const OPENING_PURPOSE = 'OPENING';

export interface OldInvoice {
  /** The old invoice number, e.g. INVAB-1234. */
  number: string;
  /** Old admin id, kept on the line for tracing. */
  legacyId?: string | null;
  date?: string | null;     // YYYY-MM-DD
  total: number;            // as invoiced, VAT included
  paid: number;             // paid or written off in the old admin
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The lines and total of a family's opening balance. Old invoices with nothing owed are left out. */
export function openingBalanceLines(items: OldInvoice[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  const lines: Array<{ description: string; amount: number; legacyId: string | null }> = [];
  for (const it of [...items].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || a.number.localeCompare(b.number))) {
    const num = String(it.number || '').trim();
    if (!num) { errors.push('An old invoice has no number.'); continue; }
    if (seen.has(num)) { errors.push(`${num} is listed twice.`); continue; }
    seen.add(num);
    if (!(Number.isFinite(it.total) && Number.isFinite(it.paid)) || it.total < 0 || it.paid < 0) { errors.push(`${num}: amounts must be 0 or more.`); continue; }
    const owed = r2(it.total - it.paid);
    if (owed < -0.005) { errors.push(`${num}: paid ${it.paid.toFixed(2)} is more than its total ${it.total.toFixed(2)} — that is a credit, not a balance; move it to the wallet instead.`); continue; }
    if (owed < 0.005) continue;
    const d = it.date && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? `${it.date.slice(8, 10)}/${it.date.slice(5, 7)}/${it.date.slice(0, 4)}` : null;
    lines.push({
      description: `${num}${d ? ` of ${d}` : ''} — invoiced AED ${it.total.toFixed(2)}, paid AED ${it.paid.toFixed(2)}`,
      amount: owed, legacyId: it.legacyId ?? null,
    });
  }
  return { lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)), errors };
}
