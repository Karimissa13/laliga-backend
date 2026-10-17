import { MigrationInterface, QueryRunner } from "typeorm";

/** Parents upload a child's photo, Emirates ID and medical insurance (17 Oct 2026): the file is kept in the database, private. Additive only. */

export class ParentDocuments1792187117326 implements MigrationInterface {
    name = 'ParentDocuments1792187117326'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" ADD "content" bytea`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "content"`);
    }

}
