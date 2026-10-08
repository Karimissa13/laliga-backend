import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgeGroup, Location, Season, Term, Venue } from '../../database/entities';
import { StructureService } from './structure.service';
import { StructureController } from './structure.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Season, Term, Location, Venue, AgeGroup])],
  controllers: [StructureController],
  providers: [StructureService],
  exports: [StructureService],
})
export class StructureModule {}
