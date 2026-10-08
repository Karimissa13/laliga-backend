import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance, Player, Session, Team, Term } from '../../database/entities';
import { SessionsService } from './sessions.service';
import { AttendanceService } from './attendance.service';
import { SchedulingController } from './scheduling.controller';
import { SeasonScheduleService } from './season-schedule.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Attendance, Player, Team, Term])],
  controllers: [SchedulingController],
  providers: [SessionsService, AttendanceService, SeasonScheduleService],
  exports: [SessionsService, AttendanceService, SeasonScheduleService],
})
export class SchedulingModule {}
