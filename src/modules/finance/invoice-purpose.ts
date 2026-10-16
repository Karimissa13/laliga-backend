import { PACKAGE_LABEL } from './pricing';

/**
 * What an invoice is for, in a few words — "Full season", "Camp", "Man City League",
 * "Salou Cup (trip)", "Kit", "Squad move-up" — for the wallet statement and ledger
 * ("where the credit was used") and the wallet payment picker.
 */

const STREAM_WORD: Record<string, string> = {
  KITS: 'Kit', MAN_CITY_LEAGUE: 'Man City League', ABU_DHABI_CUP: 'Abu Dhabi Cup',
  RAMADAN_CUP: 'Ramadan Cup', SALOU_CUP: 'Salou Cup (trip)', OTHER: 'Other',
};

/** JSON of an invoice's lines (stream, term option), for invoicePurpose. */
export const PURPOSE_LINES_SQL = (i: string) =>
  `(SELECT json_agg(json_build_object('stream', li.stream, 'package', li.package)) FROM invoice_line_items li WHERE li."invoiceId" = ${i}.id)`;
/** The kinds of programme the invoice's enrolments are in (TERM, CAMP, EVENT, LEAGUE). */
export const TERM_TYPES_SQL = (i: string) =>
  `(SELECT json_agg(DISTINCT tr.type) FROM enrolments e JOIN terms tr ON tr.id = e."termId" WHERE e."invoiceId" = ${i}.id)`;

export function invoicePurpose(lines: Array<{ stream?: string | null; package?: string | null }> | null | undefined,
  purpose?: string | null, termTypes?: string[] | null): string {
  if (purpose === 'MOVE_UP') return 'Squad move-up';
  if (purpose === 'OPENING') return 'Balance from earlier seasons';
  const parts: string[] = [];
  const add = (w: string) => { if (w && !parts.includes(w)) parts.push(w); };
  const types = new Set((termTypes || []).map(String));
  for (const l of lines || []) {
    if (l.stream === 'ACADEMY' || !l.stream) {
      if (types.has('CAMP')) add('Camp');
      else if (types.has('EVENT')) add('Event');
      else add(l.package && (PACKAGE_LABEL as any)[l.package] ? (PACKAGE_LABEL as any)[l.package] : 'Training');
    } else add(STREAM_WORD[l.stream] ?? l.stream);
  }
  return parts.join(' + ') || 'Invoice';
}
