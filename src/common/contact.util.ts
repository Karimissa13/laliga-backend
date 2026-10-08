/**
 * Contact normalisation, shared by live registration and the legacy importer so
 * a number typed at the desk and a number imported from the old system end up
 * identical — and duplicate detection can compare them.
 *
 * UAE mobiles are stored as E.164: "050 222 3344", "0502223344", "971502223344"
 * and "+971 50 222 3344" all become "+971502223344".
 */
export function normaliseMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+')) return d;
  if (d.startsWith('971')) return '+' + d;
  if (d.startsWith('0')) return '+971' + d.slice(1);
  if (d.length === 9) return '+971' + d;
  return d ? (d.startsWith('+') ? d : '+' + d) : null;
}
