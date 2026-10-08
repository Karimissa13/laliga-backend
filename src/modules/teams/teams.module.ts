import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coach, Enrolment, Player, Season, Team, User } from '../../database/entities';
import { TeamsService } from './teams.service';
import { CoachesService } from './coaches.service';
import { TeamsController } from './teams.controller';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [TypeOrmModule.forFeature([Team, Player, Enrolment, Season, Coach, User]), SchedulingModule],
  controllers: [TeamsController],
  providers: [TeamsService, CoachesService],
  exports: [TeamsService, CoachesService],
})
export class TeamsModule {}
