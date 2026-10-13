import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Data only (13 Oct 2026): cancelling an invoice now cancels the terms it bought. Invoices
 * cancelled before that left their enrolments live, so the child still showed as enrolled
 * in the package (on live: LA-000008). Same rule, applied to them — statuses only, nothing deleted.
 */
export class CancelTermsOfCancelledInvoices1791900000000 implements MigrationInterface {
    name = 'CancelTermsOfCancelledInvoices1791900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "enrolments" e SET "status" = 'CANCELLED'
            FROM "invoices" i WHERE i.id = e."invoiceId" AND i.status = 'CANCELLED' AND e.status IN ('ACTIVE', 'PENDING')`);
    }

    public async down(): Promise<void> {
        // Not reversed: which enrolments were live before cannot be told apart afterwards.
    }
}
