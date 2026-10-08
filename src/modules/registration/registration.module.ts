import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgeGroup, Enrolment, Guardian, Lead, LeadActivity, LeadEvaluation, Player, Season, Session, Team, Term,
} from '../../database/entities';
import { LeadsService } from './leads.service';
import { EnrolmentService } from './enrolment.service';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { PeopleModule } from '../people/people.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadsController } from './leads.controller';
import { TrialsService } from './trials.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, LeadActivity, LeadEvaluation, Session, Guardian, Player, Enrolment, Team, Term, Season, AgeGroup]),
    PeopleModule, // reuse GuardiansService + PlayersService
    FinanceModule, NotificationsModule,
  ],
  controllers: [RegistrationController, LeadsController],
  providers: [LeadsService, TrialsService, EnrolmentService, RegistrationService],
  exports: [LeadsService, EnrolmentService, RegistrationService],
})
export class RegistrationModule {}
