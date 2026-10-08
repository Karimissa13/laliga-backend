import type { AuthUser } from './decorators/current-user.decorator';

/** Fees, invoices, balances and wallets are shown only to roles that handle invoices (not coaches). */
export const seesMoney = (u?: AuthUser | null) => !!u && (u.permissions?.includes('*') || u.permissions?.includes('invoice.view'));
