import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, Enrolment, Guardian, Invoice, InvoiceLineItem, Player, User } from '../../database/entities';
import { ParentHomeService } from './parent-home.service';
import { FinanceModule } from '../finance/finance.module';
import { DevelopmentModule } from '../development/development.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ParentGuard, ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';

@Module({
  imports: [TypeOrmModule.forFeature([Guardian, Player, Invoice, InvoiceLineItem, Enrolment, Document, User]), FinanceModule, DevelopmentModule, NotificationsModule],
  controllers: [ParentPortalController],
  providers: [ParentPortalService, ParentGuard, ParentHomeService],
})
export class ParentPortalModule {}
