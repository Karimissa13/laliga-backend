import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgeGroup, Coach, Enrolment, Guardian, Invoice, InvoiceLineItem, Player, PlayerComment,
  Season, Team, Term, Wallet,
} from '../../database/entities';
import { PeopleModule } from '../people/people.module';
import { RegistrationModule } from '../registration/registration.module';
import { FinanceModule } from '../finance/finance.module';
import { PlayerDeskService } from './player-desk.service';
import { PlayerDeskController } from './player-desk.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Player, Guardian, Wallet, Team, Coach, Enrolment, Invoice, InvoiceLineItem,
      PlayerComment, Term, Season, AgeGroup,
    ]),
    PeopleModule, RegistrationModule, FinanceModule,
  ],
  controllers: [PlayerDeskController],
  providers: [PlayerDeskService],
})
export class PlayerDeskModule {}
