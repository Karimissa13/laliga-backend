/**
 * Normalisers for legacy data.
 *
 * These encode the specific data-quality problems found in the audit of the old
 * system, so the migration cleans as it moves rather than importing the mess:
 *   · age categories were free text — "U15", "U-15", "Girl U-15", "HPC U19"
 *   · gender was baked into the age-category name instead of its own field
 *   · payment methods contained a duplicate "Transfer"
 *   · "term" was overloaded to mean term OR camp OR tournament
 *   · seven overlapping, hand-set payment statuses
 */

import {
  Gender, InvoiceStatus, PaymentMethod, PlayerStatus, ProgramType,
} from '../database/entities';

// ---------------------------------------------------------------- age groups
export interface AgeCategoryParse {
  code: string | null;      // "U15"
  gender: Gender | null;    // extracted if the label carried it
  level: string | null;     // Development / Advanced / HPC
  original: string;
}

/** "Girl U-15" → { code: "U15", gender: FEMALE, level: null } */
export function parseAgeCategory(raw: string): AgeCategoryParse {
  const original = raw ?? '';
  const s = original.trim();
  if (!s) return { code: null, gender: null, level: null, original };

  const lower = s.toLowerCase();
  let gender: Gender | null = null;
  if (/\b(girl|girls|female|women)\b/.test(lower)) gender = Gender.FEMALE;
  else if (/\b(boy|boys|male|men)\b/.test(lower)) gender = Gender.MALE;

  let level: string | null = null;
  if (/\bhpc\b|high\s*performance/.test(lower)) level = 'HPC';
  else if (/\badv|advanced\b/.test(lower)) level = 'Advanced';
  else if (/\bdev|development\b/.test(lower)) level = 'Development';

  // U15, U-15, u 15, 15s
  const m = lower.match(/u\s*-?\s*(\d{1,2})/) || lower.match(/\b(\d{1,2})\s*s?\b/);
  const code = m ? `U${parseInt(m[1], 10)}` : null;

  return { code, gender, level, original };
}

// ------------------------------------------------------------ payment method
const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  cash: PaymentMethod.CASH,
  cheque: PaymentMethod.CHEQUE, cheques: PaymentMethod.CHEQUE, check: PaymentMethod.CHEQUE,
  card: PaymentMethod.CARD, credit: PaymentMethod.CARD, creditcard: PaymentMethod.CARD,
  cardbank: PaymentMethod.CARD, 'card/bank': PaymentMethod.CARD,
  transfer: PaymentMethod.BANK_TRANSFER, banktransfer: PaymentMethod.BANK_TRANSFER,
  bank: PaymentMethod.BANK_TRANSFER, wire: PaymentMethod.BANK_TRANSFER,
  online: PaymentMethod.ONLINE, gateway: PaymentMethod.ONLINE,
  wallet: PaymentMethod.WALLET, credit_note: PaymentMethod.WALLET,
};

/** Collapses the legacy list (incl. its duplicate "Transfer") onto the new enum. */
export function normalisePaymentMethod(raw: string): PaymentMethod | null {
  const k = (raw ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
  return PAYMENT_METHOD_MAP[k] ?? PAYMENT_METHOD_MAP[(raw ?? '').trim().toLowerCase()] ?? null;
}

// ----------------------------------------------------------- invoice status
/**
 * The legacy system had 7 hand-set statuses. In the new model status is derived
 * from the payments ledger, so this only sets a starting point — `recomputeStatus`
 * corrects it once payments are imported.
 */
export function mapInvoiceStatus(raw: string): InvoiceStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (s.includes('sponsor')) return InvoiceStatus.SPONSORED;
  if (s === 'paid') return InvoiceStatus.PAID;
  if (s.includes('partial')) return InvoiceStatus.PART_PAID;
  if (s.includes('cancel')) return InvoiceStatus.CANCELLED;
  if (s.includes('write') || s.includes('written')) return InvoiceStatus.WRITTEN_OFF;
  if (s.includes('refund')) return InvoiceStatus.REFUNDED;
  // "Invoice Issued", "Payment Pending", "Invoice Accepted" all mean: issued, unpaid
  return InvoiceStatus.ISSUED;
}

// ------------------------------------------------------------- player status
export function mapPlayerStatus(raw: string): PlayerStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (s.includes('trial')) return PlayerStatus.TRIAL;
  if (s.includes('wait')) return PlayerStatus.WAITLISTED;
  if (s.includes('withdraw') || s.includes('left') || s.includes('cancel')) return PlayerStatus.WITHDRAWN;
  if (s.includes('inactive') || s === 'no') return PlayerStatus.INACTIVE;
  if (s.includes('regist')) return PlayerStatus.REGISTERED;
  return PlayerStatus.ACTIVE;
}

// --------------------------------------------------------------- programme
/** Splits the overloaded legacy "term" into Term / Camp / Event / League. */
export function classifyProgramme(name: string): ProgramType {
  const s = (name ?? '').toLowerCase();
  if (/\bcamp\b/.test(s)) return ProgramType.CAMP;
  if (/\bcup\b|\btournament\b|\bchampionship\b|\bfestival\b/.test(s)) return ProgramType.EVENT;
  if (/\bleague\b/.test(s)) return ProgramType.LEAGUE;
  return ProgramType.TERM;
}

// ------------------------------------------------------------------ contact
/** UAE numbers appear as 05x…, +9715x…, 009715x… — store one canonical form. */
// One implementation, shared with live registration.
import { normaliseMobile } from '../common/contact.util';
export { normaliseMobile };

export function normaliseEmail(raw: string): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

export function normaliseName(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Legacy dates arrive as dd/mm/yyyy, yyyy-mm-dd or Excel serials. */
export function normaliseDate(raw: any): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && raw > 20000 && raw < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) as any);
    d.setUTCDate(d.getUTCDate() + raw);
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    // dd/mm/yyyy is the UAE convention; fall back to mm/dd when day > 12
    const day = Number(a) > 12 ? a : a;
    const month = b;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Money may arrive as "AED 3,801.00" or "3801". */
export function normaliseMoney(raw: any): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/** Identity key for de-duplicating guardians across messy exports. */
export function guardianKey(email?: string | null, mobile?: string | null, name?: string | null): string {
  const e = normaliseEmail(email ?? '');
  if (e) return 'e:' + e;
  const m = normaliseMobile(mobile ?? '');
  if (m) return 'm:' + m;
  return 'n:' + normaliseName(name ?? '').toLowerCase();
}
