import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrolment, Guardian, Invoice, InvoiceLineItem, Player } from '../../database/entities';
import { FinanceModule } from '../finance/finance.module';
import { DevelopmentModule } from '../development/development.module';
import { ParentGuard, ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';

@Module({
  imports: [TypeOrmModule.forFeature([Guardian, Player, Invoice, InvoiceLineItem, Enrolment]), FinanceModule, DevelopmentModule],
  controllers: [ParentPortalController],
  providers: [ParentPortalService, ParentGuard],
})
export class ParentPortalModule {}
