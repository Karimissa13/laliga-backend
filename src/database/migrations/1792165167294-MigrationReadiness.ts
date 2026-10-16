import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ready for the move from the old admin (16 Oct 2026). Additive only:
 * - legacyId (the record's id in the old admin) on every table the import fills;
 * - parent nationality, address, area (the extra details Karim chose to keep);
 * - "forgot password" for parents (hash of the one-time code, expiry, last request);
 * - enrolments.trainingDays: the team's days a child attends when coming fewer times a week.
 */

export class MigrationReadiness1792165167294 implements MigrationInterface {
    name = 'MigrationReadiness1792165167294'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "resetTokenHash" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "resetTokenExpiresAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "resetRequestedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "nationality" character varying(60)`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "address" text`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD "area" character varying(80)`);
        await queryRunner.query(`ALTER TABLE "players" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "player_comments" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "seasons" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "terms" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "teams" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "invoice_line_items" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "invoice_instalments" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "applied_discounts" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "leads" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "enrolments" ADD "legacyId" character varying(40)`);
        await queryRunner.query(`CREATE TYPE "public"."enrolments_trainingdays_enum" AS ENUM('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')`);
        await queryRunner.query(`ALTER TABLE "enrolments" ADD "trainingDays" "public"."enrolments_trainingdays_enum" array`);
        await queryRunner.query(`CREATE INDEX "IDX_a24471f1f54a49abc6becc2c87" ON "users" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9bf21231d1267643e29f87c1f4" ON "guardians" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3886b7c625cb9c09faf84bc745" ON "players" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d9b7300eb426e82382cff25efa" ON "player_comments" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6f143f6349ec5d25c4e8177336" ON "seasons" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_278f0597b7d2115aaa8a43c48d" ON "terms" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fe1604c009fe9dfd5b342f3728" ON "teams" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_146353ebff316af412b3b2dce6" ON "invoices" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9394b140a884fadf8a679bfde3" ON "invoice_line_items" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f994070f8971f60ff48a080886" ON "payments" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3926bd90f1d083b7c5b31b9ef1" ON "invoice_instalments" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f4e63d96ab03ac17f7ad2f720c" ON "applied_discounts" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f6e2926f94327ef210480abd5c" ON "wallet_transactions" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ebc00dae81e80c90a93c568184" ON "leads" ("legacyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_426f71ae30cd9faea97f2ee0e6" ON "enrolments" ("legacyId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_426f71ae30cd9faea97f2ee0e6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ebc00dae81e80c90a93c568184"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f6e2926f94327ef210480abd5c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f4e63d96ab03ac17f7ad2f720c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3926bd90f1d083b7c5b31b9ef1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f994070f8971f60ff48a080886"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9394b140a884fadf8a679bfde3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_146353ebff316af412b3b2dce6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fe1604c009fe9dfd5b342f3728"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_278f0597b7d2115aaa8a43c48d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6f143f6349ec5d25c4e8177336"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9b7300eb426e82382cff25efa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3886b7c625cb9c09faf84bc745"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9bf21231d1267643e29f87c1f4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a24471f1f54a49abc6becc2c87"`);
        await queryRunner.query(`ALTER TABLE "enrolments" DROP COLUMN "trainingDays"`);
        await queryRunner.query(`DROP TYPE "public"."enrolments_trainingdays_enum"`);
        await queryRunner.query(`ALTER TABLE "enrolments" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "applied_discounts" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "invoice_instalments" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "invoice_line_items" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "teams" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "terms" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "seasons" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "player_comments" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "players" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "area"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "address"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "nationality"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "resetRequestedAt"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "resetTokenExpiresAt"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "resetTokenHash"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "legacyId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "legacyId"`);
    }

}
