import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgeGroup, AppliedDiscount, Coach, Enrolment, Guardian, Invoice, InvoiceLineItem, Player, PlayerComment,
  Season, Team, Term, Wallet,
} from '../../database/entities';
import { SquadMoveService } from './squad-move.service';
import { SquadMoveController } from './squad-move.controller';
import { PeopleModule } from '../people/people.module';
import { RegistrationModule } from '../registration/registration.module';
import { FinanceModule } from '../finance/finance.module';
import { PlayerDeskService } from './player-desk.service';
import { PlayerDeskController } from './player-desk.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Player, Guardian, Wallet, Team, Coach, Enrolment, Invoice, InvoiceLineItem,
      PlayerComment, Term, Season, AgeGroup, AppliedDiscount,
    ]),
    PeopleModule, RegistrationModule, FinanceModule,
  ],
  controllers: [PlayerDeskController, SquadMoveController],
  providers: [PlayerDeskService, SquadMoveService],
})
export class PlayerDeskModule {}
