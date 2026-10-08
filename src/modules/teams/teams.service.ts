import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Coach, Enrolment, EnrolmentStatus, Player, Season, Team,
} from '../../database/entities';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
  ) {}

  list(includeInactive = false) {
    return this.teams.find({
      where: includeInactive ? {} : { isActive: true },
      relations: { season: true, ageGroup: true, location: true, headCoach: { user: true } },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    const team = await this.teams.findOne({
      where: { id },
      relations: { season: true, ageGroup: true, location: true, headCoach: { user: true } },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(input: Partial<Team>) {
    return this.teams.save(this.teams.create(input));
  }

  async update(id: string, input: Partial<Team>) {
    await this.findOne(id);
    await this.teams.update(id, input);
    return this.findOne(id);
  }

  /** Current roster + capacity usage. */
  async roster(id: string) {
    const team = await this.findOne(id);
    const players = await this.players.find({
      where: { currentTeamId: id },
      relations: { ageGroup: true, guardian: true },
      order: { firstName: 'ASC' },
    });
    return {
      team: { id: team.id, name: team.name, capacity: team.capacity },
      count: players.length,
      capacity: team.capacity,
      available: Math.max(0, team.capacity - players.length),
      isFull: players.length >= team.capacity,
      players,
    };
  }

  private async activeSeasonId(): Promise<string | null> {
    const s = await this.seasons.findOne({ where: { isActive: true } });
    return s?.id ?? null;
  }

  /**
   * Move a player to a new team. Enforces capacity, updates the player's current
   * team, and writes enrolment history: the prior active enrolment for the season
   * is marked TRANSFERRED and a new ACTIVE enrolment is created. Prior data is kept.
   */
  async transferPlayer(input: { playerId: string; toTeamId: string; seasonId?: string; termId?: string }) {
    const player = await this.players.findOne({ where: { id: input.playerId } });
    if (!player) throw new BadRequestException('Invalid playerId');
    const team = await this.findOne(input.toTeamId);

    const currentCount = await this.players.count({ where: { currentTeamId: team.id } });
    if (currentCount >= team.capacity) {
      throw new BadRequestException(`Team "${team.name}" is at capacity (${team.capacity})`);
    }

    const seasonId = input.seasonId ?? (await this.activeSeasonId());
    if (!seasonId) throw new BadRequestException('No season specified and no active season set');

    const fromTeamId = player.currentTeamId;
    // Close prior active enrolment(s) for this season.
    await this.enrolments.update(
      { playerId: player.id, seasonId, status: EnrolmentStatus.ACTIVE },
      { status: EnrolmentStatus.TRANSFERRED, endedAt: new Date() },
    );
    // New enrolment record (history preserved).
    if (input.termId) {
      await this.enrolments.save(this.enrolments.create({
        playerId: player.id, seasonId, termId: input.termId, teamId: team.id,
        status: EnrolmentStatus.ACTIVE,
      }));
    }
    await this.players.update(player.id, { currentTeamId: team.id });

    return { success: true, playerId: player.id, fromTeamId, toTeamId: team.id, seasonId };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.teams.update(id, { isActive: false });
    return { success: true, id, deactivated: true };
  }
}
