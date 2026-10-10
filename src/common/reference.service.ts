import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { makeReference } from './reference.util';

const SEQUENCES: Record<string, string> = {
  PR: 'guardian_ref_seq', // parents/guardians
  PL: 'player_ref_seq',
  TR: 'lead_ref_seq', // trials/leads
  LA: 'invoice_ref_seq',
  CN: 'credit_note_ref_seq', // tax credit notes
};

/**
 * Allocates gap-free, collision-safe reference codes (PR-000001 etc.) using
 * dedicated Postgres sequences. Created idempotently on boot.
 */
@Injectable()
export class ReferenceService implements OnModuleInit {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async onModuleInit() {
    for (const seq of Object.values(SEQUENCES)) {
      await this.ds.query(`CREATE SEQUENCE IF NOT EXISTS ${seq} START 1`);
    }
  }

  async next(prefix: keyof typeof SEQUENCES | string): Promise<string> {
    const seq = SEQUENCES[prefix];
    if (!seq) throw new Error(`No sequence for prefix ${prefix}`);
    const rows = await this.ds.query(`SELECT nextval('${seq}') AS v`);
    return makeReference(prefix, Number(rows[0].v));
  }
}

@Global()
@Module({ providers: [ReferenceService], exports: [ReferenceService] })
export class ReferenceModule {}
