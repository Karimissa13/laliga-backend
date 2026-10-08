import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance, Document, Enrolment, Evaluation, Player } from '../../database/entities';
import { DevelopmentService } from './development.service';
import { DevelopmentController } from './development.controller';
import { DevelopmentReportsService } from './reports.service';
import { ReportPdfService } from './report-pdf.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Evaluation, Player, Enrolment, Attendance, Document]), NotificationsModule],
  controllers: [DevelopmentController],
  providers: [DevelopmentService, DevelopmentReportsService, ReportPdfService],
  exports: [DevelopmentService, DevelopmentReportsService, ReportPdfService],
})
export class DevelopmentModule {}
