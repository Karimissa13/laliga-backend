/** Zero-padded reference codes: PR- guardians, PL- players, TR- leads/trials, LA- invoices. */
export function makeReference(prefix: string, seq: number, pad = 6): string {
  return `${prefix}-${String(seq).padStart(pad, '0')}`;
}
