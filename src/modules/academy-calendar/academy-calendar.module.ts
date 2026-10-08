import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademyEvent } from '../../database/entities';
import { AcademyCalendarService } from './academy-calendar.service';
import { AcademyCalendarController } from './academy-calendar.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AcademyEvent])],
  controllers: [AcademyCalendarController],
  providers: [AcademyCalendarService],
  exports: [AcademyCalendarService],
})
export class AcademyCalendarModule {}
