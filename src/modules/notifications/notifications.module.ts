import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Communication, Guardian, Invoice, Player } from '../../database/entities';
import { FinanceModule } from '../finance/finance.module';
import { MailerService } from './mailer.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PaymentRemindersService } from './payment-reminders.service';
import { PaymentRemindersController } from './payment-reminders.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Communication, Guardian, Invoice, Player]), FinanceModule],
  controllers: [NotificationsController, PaymentRemindersController],
  providers: [MailerService, NotificationsService, PaymentRemindersService],
  exports: [NotificationsService, MailerService, PaymentRemindersService],
})
export class NotificationsModule {}
