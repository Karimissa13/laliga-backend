import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../../database/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { InvoiceBulkController } from './invoice-bulk.controller';
import { InvoiceBulkService } from './invoice-bulk.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice]), NotificationsModule, PaymentLinksModule],
  controllers: [InvoiceBulkController],
  providers: [InvoiceBulkService],
})
export class InvoiceBulkModule {}
