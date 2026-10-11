import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Squad moves (Karim, 12 Oct 2026). Reviewed by hand: additive and nullable only —
 * existing invoices and enrolments are untouched.
 *  - invoices.purpose ('MOVE_UP') and invoices.relatedInvoiceId (the original term invoice);
 *  - enrolments.movedFromId (the enrolment it replaced) and enrolments.moveUpInvoiceId.
 */
export class SquadMoves1791754261492 implements MigrationInterface {
    name = 'SquadMoves1791754261492'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invoices" ADD "purpose" character varying(16)`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "relatedInvoiceId" uuid`);
        await queryRunner.query(`ALTER TABLE "enrolments" ADD "movedFromId" uuid`);
        await queryRunner.query(`ALTER TABLE "enrolments" ADD "moveUpInvoiceId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_ad219e3902dd1cba9ae31d7002" ON "invoices" ("relatedInvoiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3355b78112c64e5858c722220d" ON "enrolments" ("movedFromId") `);
        await queryRunner.query(`CREATE INDEX "IDX_7103cb96c95085293e4f9d6c85" ON "enrolments" ("moveUpInvoiceId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_7103cb96c95085293e4f9d6c85"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3355b78112c64e5858c722220d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ad219e3902dd1cba9ae31d7002"`);
        await queryRunner.query(`ALTER TABLE "enrolments" DROP COLUMN "moveUpInvoiceId"`);
        await queryRunner.query(`ALTER TABLE "enrolments" DROP COLUMN "movedFromId"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "relatedInvoiceId"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "purpose"`);
    }

}
