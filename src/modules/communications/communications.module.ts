import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Communication, CommunicationTemplate, Enrolment, Guardian, Invoice, Lead, Player, Session, Term,
} from '../../database/entities';
import { CommunicationsService } from './communications.service';
import { AutomationsService } from './automations.service';
import { SchedulerService } from './scheduler.service';
import { CommunicationsController } from './communications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    Communication, CommunicationTemplate, Guardian, Player, Invoice, Lead, Enrolment, Term, Session,
  ]), ScheduleModule.forRoot()],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, AutomationsService, SchedulerService],
  exports: [CommunicationsService, AutomationsService, SchedulerService],
})
export class CommunicationsModule {}
