import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Communication, Guardian, Invoice, Player } from '../../database/entities';
import { FinanceModule } from '../finance/finance.module';
import { MailerService } from './mailer.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Communication, Guardian, Invoice, Player]), FinanceModule],
  controllers: [NotificationsController],
  providers: [MailerService, NotificationsService],
  exports: [NotificationsService, MailerService],
})
export class NotificationsModule {}
