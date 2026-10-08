import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../database/entities';

export interface AuditEntry {
  actorId?: string;
  actorType?: string;
  action: string;
  entity?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  /** Write an immutable audit record. Never throws into the caller's flow. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.repo.insert({
        actorId: entry.actorId ?? null,
        actorType: entry.actorType ?? 'user',
        action: entry.action,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ?? null,
      } as any);
    } catch (e) {
      // Audit logging must never break the request — but a lost entry must be
      // visible to whoever runs the server, not silently swallowed.
      this.logger.error(`Audit entry NOT written for ${entry.action}: ${(e as Error).message}`);
    }
  }

  find(params: { entity?: string; entityId?: string; actorId?: string; action?: string; take?: number }) {
    const where: any = {};
    if (params.entity) where.entity = params.entity;
    if (params.entityId) where.entityId = params.entityId;
    if (params.actorId) where.actorId = params.actorId;
    if (params.action) where.action = params.action;
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(params.take ?? 50, 200),
    });
  }
}
