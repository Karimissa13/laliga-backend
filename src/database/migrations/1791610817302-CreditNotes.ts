import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Tax credit notes (CN-000001 …): one per refund, forgiven amount (write-off or
 * instalment waiver, when not a bad debt) or cancelled issued invoice.
 *
 * Reviewed by hand. Generated table + indexes + foreign keys, plus:
 *  - the CN- number sequence (the app also creates it on boot, for databases built
 *    with DB_SYNCHRONIZE);
 *  - a trigger that refuses UPDATE and DELETE: a credit note is a tax record and is
 *    never edited or removed (DROP SCHEMA in the dev reset is unaffected).
 */
export class CreditNotes1791610817302 implements MigrationInterface {
    name = 'CreditNotes1791610817302'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."credit_notes_kind_enum" AS ENUM('REFUND', 'WRITE_OFF', 'CANCELLATION')`);
        await queryRunner.query(`CREATE TABLE "credit_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "number" character varying NOT NULL, "invoiceId" uuid NOT NULL, "guardianId" uuid NOT NULL, "kind" "public"."credit_notes_kind_enum" NOT NULL, "issueDate" date NOT NULL, "total" numeric(10,2) NOT NULL, "vatAmount" numeric(10,2) NOT NULL, "netAmount" numeric(10,2) NOT NULL, "reason" character varying(250) NOT NULL, "paymentId" uuid, "instalmentSeq" integer, "createdById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4933888a20b5469e119ad74b9e9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_285b86d3158b74d5e053c75cf7" ON "credit_notes" ("number") `);
        await queryRunner.query(`CREATE INDEX "IDX_a85bd9f4e7e57d49f830f38b05" ON "credit_notes" ("invoiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6adbb7f7137a8bab4097270204" ON "credit_notes" ("guardianId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6374c2521ff43b2af61ffe0a22" ON "credit_notes" ("issueDate") `);
        await queryRunner.query(`ALTER TABLE "credit_notes" ADD CONSTRAINT "FK_a85bd9f4e7e57d49f830f38b05d" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credit_notes" ADD CONSTRAINT "FK_6adbb7f7137a8bab4097270204b" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS credit_note_ref_seq START 1`);
        await queryRunner.query(`CREATE OR REPLACE FUNCTION credit_notes_are_records() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Credit notes are records: they cannot be changed or deleted'; END $$`);
        await queryRunner.query(`CREATE TRIGGER credit_notes_no_change BEFORE UPDATE OR DELETE ON "credit_notes"
            FOR EACH ROW EXECUTE FUNCTION credit_notes_are_records()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS credit_notes_no_change ON "credit_notes"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS credit_notes_are_records()`);
        await queryRunner.query(`DROP SEQUENCE IF EXISTS credit_note_ref_seq`);
        await queryRunner.query(`ALTER TABLE "credit_notes" DROP CONSTRAINT "FK_6adbb7f7137a8bab4097270204b"`);
        await queryRunner.query(`ALTER TABLE "credit_notes" DROP CONSTRAINT "FK_a85bd9f4e7e57d49f830f38b05d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6374c2521ff43b2af61ffe0a22"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6adbb7f7137a8bab4097270204"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a85bd9f4e7e57d49f830f38b05"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_285b86d3158b74d5e053c75cf7"`);
        await queryRunner.query(`DROP TABLE "credit_notes"`);
        await queryRunner.query(`DROP TYPE "public"."credit_notes_kind_enum"`);
    }

}
