import { MigrationInterface, QueryRunner } from "typeorm";

export class WalletLinks1791834164432 implements MigrationInterface {
    name = 'WalletLinks1791834164432'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" ADD "reversalOfId" uuid`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "kind" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "invoiceId" uuid`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "paymentId" uuid`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "createdById" uuid`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "reversalOfId" uuid`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "cancelledAt" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "cancelledById" uuid`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "cancelReason" character varying(250)`);
        await queryRunner.query(`CREATE INDEX "IDX_581a824e911b9baa6be19cd92f" ON "wallet_transactions" ("invoiceId") `);
        // Entries made before this release: their kind and invoice, from the wording they were written with.
        await queryRunner.query(`UPDATE "wallet_transactions" SET "kind" = CASE
              WHEN "reason" LIKE 'Overpayment on %' THEN 'OVERPAYMENT'
              WHEN "reason" LIKE 'Refund from %' THEN 'REFUND'
              WHEN "reason" LIKE 'Applied to invoice %' THEN 'INVOICE_PAYMENT'
              WHEN "reason" LIKE 'Sibling discount credit%' THEN 'SIBLING'
              WHEN "type" = 'CREDIT' THEN 'CREDIT' ELSE 'DEBIT' END
            WHERE "kind" IS NULL`);
        await queryRunner.query(`UPDATE "wallet_transactions" t SET "invoiceId" = i.id
            FROM "invoices" i WHERE t."invoiceId" IS NULL AND i.number = substring(t."reason" from 'LA-[0-9]+')`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_581a824e911b9baa6be19cd92f"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "cancelReason"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "cancelledById"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "cancelledAt"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "reversalOfId"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "createdById"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "paymentId"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "invoiceId"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "kind"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "reversalOfId"`);
    }

}
