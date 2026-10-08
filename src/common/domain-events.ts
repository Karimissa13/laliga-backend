import { Global, Injectable, Logger, Module } from '@nestjs/common';

export type DomainEvent =
  | { type: 'player.created'; playerId: string; guardianId: string; actorId?: string }
  | { type: 'invoice.issued'; invoiceId: string; actorId?: string };

type Listener = (e: DomainEvent) => Promise<void> | void;

/**
 * Tiny in-process event bus, so modules can react to each other (send the
 * welcome email when a child is registered, email the invoice when it is
 * issued) without importing each other. Listeners are awaited, and a failing
 * listener is logged — it never fails the request that raised the event.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger('DomainEvents');
  private readonly listeners = new Map<string, Listener[]>();

  on<T extends DomainEvent['type']>(type: T, fn: (e: Extract<DomainEvent, { type: T }>) => Promise<void> | void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn as Listener]);
  }

  async emit(e: DomainEvent): Promise<void> {
    for (const fn of this.listeners.get(e.type) ?? []) {
      try { await fn(e); }
      catch (err) { this.logger.error(`${e.type} listener failed: ${(err as Error).message}`); }
    }
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
