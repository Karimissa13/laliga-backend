import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  AgeGroup, Enrolment, EnrolmentStatus, Player, PlayerStatus, Season, Team, Term,
} from '../../database/entities';

/**
 * Enrolment = a player's participation in a term/team. Enrolling respects team
 * capacity (waitlists when full) and always writes a history record.
 */
@Injectable()
export class EnrolmentService {
  constructor(
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
    @InjectRepository(AgeGroup) private readonly ageGroups: Repository<AgeGroup>,
  ) {}

  /**
   * Does this team take a child of this category? Teams list the categories they
   * take in `ageCodes` (U16/18 Development takes both). A team with no codes set
   * takes anyone, so older data keeps working.
   */
  private async categoryFits(player: Player, team: Team): Promise<{ ok: boolean; childCode: string | null }> {
    const codes = team.ageCodes ?? [];
    if (!player.ageGroupId) return { ok: codes.length === 0, childCode: null };
    const ag = await this.ageGroups.findOne({ where: { id: player.ageGroupId } });
    const childCode = ag?.code ?? null;
    return { ok: codes.length === 0 || (!!childCode && codes.includes(childCode)), childCode };
  }

  private async resolveSeasonId(explicit?: string, termId?: string): Promise<string> {
    if (explicit) return explicit;
    if (termId) {
      const term = await this.terms.findOne({ where: { id: termId } });
      if (term) return term.seasonId;
    }
    const active = await this.seasons.findOne({ where: { isActive: true } });
    if (!active) throw new BadRequestException('No season specified and no active season set');
    return active.id;
  }

  async enrol(input: {
    playerId: string; termId: string; teamId?: string; seasonId?: string;
    /** Deliberately place a child outside their category (e.g. playing a strong U11 up). */
    allowCategoryOverride?: boolean;
  }) {
    const player = await this.players.findOne({ where: { id: input.playerId } });
    if (!player) throw new BadRequestException('Invalid playerId');
    const term = await this.terms.findOne({ where: { id: input.termId } });
    if (!term) throw new BadRequestException('Invalid termId');
    const seasonId = await this.resolveSeasonId(input.seasonId, input.termId);

    let teamId = input.teamId;
    let waitlisted = false;

    let placedTeam: Team | null = null;
    if (teamId) {
      const team = await this.teams.findOne({ where: { id: teamId } });
      if (!team) throw new BadRequestException('Invalid teamId');
      placedTeam = team;
      // The legacy system let any child be put on any team, which is how its age
      // data drifted. A mismatch now needs a deliberate override.
      const fit = await this.categoryFits(player, team);
      if (!fit.ok && !input.allowCategoryOverride) {
        throw new BadRequestException({
          error: 'CategoryMismatch',
          message: `${team.name} takes ${team.ageCodes.join(' / ')}, but this child is ${fit.childCode ?? 'uncategorised'}. ` +
            'Choose a matching team, or confirm the override to place them outside their category.',
          teamCategories: team.ageCodes,
          childCategory: fit.childCode,
        });
      }
      // A child already on this team (renewing, or the next term of a multi-term
      // purchase) is not taking a new place, so they are not counted against it.
      const count = await this.players.count({ where: { currentTeamId: teamId, id: Not(player.id), archivedAt: IsNull() } });
      if (count >= team.capacity) {
        // Team full → waitlist rather than reject.
        waitlisted = true;
        teamId = undefined;
      }
    }

    // Prevent duplicate active enrolment for the same player+term.
    const existing = await this.enrolments.findOne({
      where: { playerId: player.id, termId: term.id, status: EnrolmentStatus.ACTIVE },
    });
    if (existing) throw new BadRequestException('Player is already enrolled in this term');

    const enrolment = await this.enrolments.save(this.enrolments.create({
      playerId: player.id,
      seasonId,
      termId: term.id,
      teamId: teamId ?? undefined,
      status: waitlisted ? EnrolmentStatus.PENDING : EnrolmentStatus.ACTIVE,
    }));

    // Update player status + current team.
    const patch: Partial<Player> = {};
    if (waitlisted) {
      patch.status = PlayerStatus.WAITLISTED;
    } else {
      patch.status = PlayerStatus.ACTIVE;
      if (teamId) patch.currentTeamId = teamId;
    }
    // The level travels with the placement, so a waitlisted child keeps the level
    // they were assessed at even before a place opens up.
    if (placedTeam) patch.level = placedTeam.level;
    await this.players.update(player.id, patch);

    return { enrolment, waitlisted };
  }

  /** Renew a player into a new term (keeps the same team if one is given). */
  async renew(input: { playerId: string; termId: string; teamId?: string }) {
    return this.enrol({ playerId: input.playerId, termId: input.termId, teamId: input.teamId });
  }

  history(playerId: string) {
    return this.enrolments.find({
      where: { playerId },
      relations: { season: true, term: true, team: true },
      order: { enrolledAt: 'DESC' },
    });
  }
}
