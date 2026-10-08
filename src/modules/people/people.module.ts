import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgeGroup, Enrolment, Guardian, Player, PlayerComment, Season, Wallet,
} from '../../database/entities';
import { GuardiansService } from './guardians.service';
import { GuardiansController } from './guardians.controller';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { PlayerDirectoryService } from './player-directory.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    Guardian, Player, PlayerComment, Wallet, AgeGroup, Season, Enrolment,
  ])],
  controllers: [GuardiansController, PlayersController],
  providers: [GuardiansService, PlayersService, PlayerDirectoryService],
  exports: [GuardiansService, PlayersService, PlayerDirectoryService],
})
export class PeopleModule {}
