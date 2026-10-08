import { SetMetadata } from '@nestjs/common';
export const AUDIT_KEY = 'audit';
export interface AuditMeta { action: string; entity?: string; }
/** Records this action to the immutable audit log after a successful call. */
export const Audit = (action: string, entity?: string) =>
  SetMetadata(AUDIT_KEY, { action, entity } as AuditMeta);
