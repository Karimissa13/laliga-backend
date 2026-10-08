import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enrolment, Gender, Guardian, Player } from '../../database/entities';
import { GuardiansService } from '../people/guardians.service';
import { PlayersService } from '../people/players.service';
import { EnrolmentService } from './enrolment.service';

/**
 * One-flow registration: identify or create the guardian, create the player,
 * and (optionally) enrol into a term/team in a single call — the admin's most
 * common daily task, automated end to end.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    private readonly guardiansService: GuardiansService,
    private readonly playersService: PlayersService,
    private readonly enrolmentService: EnrolmentService,
  ) {}

  async register(input: {
    guardianId?: string; guardianName?: string; guardianEmail?: string; guardianMobile?: string;
    firstName: string; lastName: string; gender: Gender; dateOfBirth: string;
    termId?: string; teamId?: string; seasonId?: string;
  }) {
    // 1) Resolve guardian: by id, by existing email, or create new.
    let guardian: Guardian | null = null;
    if (input.guardianId) {
      guardian = await this.guardians.findOne({ where: { id: input.guardianId } });
      if (!guardian) throw new BadRequestException('Invalid guardianId');
    } else if (input.guardianEmail) {
      guardian = await this.guardians.findOne({ where: { email: input.guardianEmail.toLowerCase() } });
      if (!guardian) {
        if (!input.guardianName || !input.guardianMobile) {
          throw new BadRequestException('guardianName and guardianMobile are required to create a new guardian');
        }
        guardian = await this.guardiansService.create({
          fullName: input.guardianName, email: input.guardianEmail, mobile: input.guardianMobile,
        });
      }
    } else {
      throw new BadRequestException('Provide guardianId or guardianEmail');
    }

    // 2) Create the player (age group auto-derived).
    const player = await this.playersService.create({
      guardianId: guardian.id,
      firstName: input.firstName, lastName: input.lastName,
      gender: input.gender, dateOfBirth: input.dateOfBirth,
    });

    // 3) Optionally enrol immediately.
    let enrolment: Enrolment | null = null;
    let waitlisted = false;
    if (input.termId) {
      const res = await this.enrolmentService.enrol({
        playerId: player.id, termId: input.termId, teamId: input.teamId, seasonId: input.seasonId,
      });
      enrolment = res.enrolment;
      waitlisted = res.waitlisted;
    }

    return {
      guardian: { id: guardian.id, reference: guardian.reference, fullName: guardian.fullName },
      player: { id: player.id, reference: player.reference, name: `${player.firstName} ${player.lastName}`,
        ageGroup: player.ageGroup?.code, status: waitlisted ? 'WAITLISTED' : player.status },
      enrolment,
      waitlisted,
      // Next step for the admin UI (invoice generation lands in the Finance phase).
      nextStep: enrolment ? 'generate-invoice' : 'enrol',
    };
  }
}
