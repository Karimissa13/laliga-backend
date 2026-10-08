import { normaliseMobile } from '../../common/contact.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  AgeGroup, Enrolment, Guardian, Player, PlayerComment, PlayerStatus, Season, TeamLevel,
} from '../../database/entities';
import { ReferenceService } from '../../common/reference.service';
import { DomainEvents } from '../../common/domain-events';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import { CategoryPlacement, deriveAgeGroupCode, placeInCategory } from './age-group.util';

export interface PlayerFilter extends PaginationDto {
  status?: PlayerStatus;
  guardianId?: string;
  teamId?: string;
  ageGroupId?: string;
}

@Injectable()
export class PlayersService {
  constructor(
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(AgeGroup) private readonly ageGroups: Repository<AgeGroup>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(PlayerComment) private readonly comments: Repository<PlayerComment>,
    private readonly refs: ReferenceService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Place a child in an age category from their date of birth, using the active
   * season's cutoff and the academy's play-up rule for gap years (U7 → U8 etc.).
   * Public so the registration screen can show the result before anything is saved.
   */
  async placeByDob(dob: string): Promise<CategoryPlacement & { ageGroup: AgeGroup | null }> {
    const activeSeason = await this.seasons.findOne({ where: { isActive: true } });
    const exact = deriveAgeGroupCode(dob, activeSeason?.cutoffDate);
    const active = await this.ageGroups.find({ where: { isActive: true } });
    const placement = placeInCategory(exact, active.map((a) => a.code));
    const ageGroup = placement.code ? active.find((a) => a.code === placement.code) ?? null : null;
    return { ...placement, ageGroup };
  }

  private async resolveAgeGroup(dob: string): Promise<AgeGroup | null> {
    return (await this.placeByDob(dob)).ageGroup;
  }

  async list(q: PlayerFilter) {
    const qb = this.players.createQueryBuilder('p')
      .leftJoinAndSelect('p.guardian', 'g')
      .leftJoinAndSelect('p.ageGroup', 'ag')
      .leftJoinAndSelect('p.currentTeam', 't')
      .orderBy('p.createdAt', 'DESC')
      .skip(q.skip).take(q.limit);
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.guardianId) qb.andWhere('p.guardianId = :gid', { gid: q.guardianId });
    if (q.teamId) qb.andWhere('p.currentTeamId = :tid', { tid: q.teamId });
    if (q.ageGroupId) qb.andWhere('p.ageGroupId = :agid', { agid: q.ageGroupId });
    if (q.search) {
      qb.andWhere(new Brackets((w) => {
        w.where('p.firstName ILIKE :s', { s: `%${q.search}%` })
          .orWhere('p.lastName ILIKE :s', { s: `%${q.search}%` })
          .orWhere('p.reference ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.fullName ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.mobile ILIKE :s', { s: `%${q.search}%` });
      }));
    }
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  async findOne(id: string) {
    const player = await this.players.findOne({
      where: { id },
      relations: { guardian: true, ageGroup: true, currentTeam: true, comments: true },
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  async create(input: {
    guardianId: string; firstName: string; lastName: string; gender: any; dateOfBirth: string;
    email?: string; mobile?: string; kitSize?: string; previousAcademy?: string;
    emergencyContactName?: string; emergencyContactPhone?: string; medicalNotes?: string;
    status?: PlayerStatus;
    level?: TeamLevel;
    /** Manual category, when the date of birth can't place the child (e.g. older than U18). */
    ageGroupId?: string;
  }, opts: { notify?: boolean; actorId?: string } = {}) {
    const guardian = await this.guardians.findOne({ where: { id: input.guardianId } });
    if (!guardian) throw new BadRequestException('Invalid guardianId');
    const derived = await this.resolveAgeGroup(input.dateOfBirth);
    const manual = input.ageGroupId && input.ageGroupId !== derived?.id
      ? await this.ageGroups.findOne({ where: { id: input.ageGroupId } })
      : null;
    if (input.ageGroupId && !manual && input.ageGroupId !== derived?.id) {
      throw new BadRequestException('Invalid ageGroupId');
    }
    const ageGroup = manual ?? derived;
    const player = this.players.create({
      reference: await this.refs.next('PL'),
      guardianId: input.guardianId,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      email: input.email,
      mobile: normaliseMobile(input.mobile) ?? undefined,
      kitSize: input.kitSize,
      previousAcademy: input.previousAcademy,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: normaliseMobile(input.emergencyContactPhone) ?? undefined,
      medicalNotes: input.medicalNotes,
      status: input.status ?? PlayerStatus.TRIAL,
      ageGroupId: ageGroup?.id ?? undefined,
      ageGroupOverride: !!manual,
      level: input.level ?? undefined,
    });
    const saved = await this.players.save(player);
    // Lets the notifications module send the parent their welcome / sign-in
    // details. Bulk imports pass notify:false so no one is emailed by accident.
    if (opts.notify !== false) {
      await this.events.emit({ type: 'player.created', playerId: saved.id, guardianId: saved.guardianId, actorId: opts.actorId });
    }
    return this.findOne(saved.id);
  }

  async update(id: string, input: any) {
    const player = await this.findOne(id);
    const patch: any = { ...input };
    delete patch.id;
    delete patch.reference;
    delete patch.guardianId; // moving a child between guardians is a separate, audited action
    if (typeof input.mobile === 'string') patch.mobile = normaliseMobile(input.mobile);
    if (typeof input.emergencyContactPhone === 'string') patch.emergencyContactPhone = normaliseMobile(input.emergencyContactPhone);
    // Re-derive age group when DOB changes, unless an override is in force.
    if (input.dateOfBirth && !player.ageGroupOverride) {
      const ag = await this.resolveAgeGroup(input.dateOfBirth);
      patch.ageGroupId = ag?.id ?? null;
    }
    // Explicit manual category override…
    if (input.ageGroupId) {
      patch.ageGroupOverride = true;
    }
    // …and `ageGroupId: null` hands the category back to the date of birth.
    if (input.ageGroupId === null) {
      const ag = await this.resolveAgeGroup(input.dateOfBirth ?? player.dateOfBirth);
      patch.ageGroupId = ag?.id ?? null;
      patch.ageGroupOverride = false;
    }
    await this.players.update(id, patch);
    return this.findOne(id);
  }

  async setStatus(id: string, status: PlayerStatus) {
    await this.findOne(id);
    await this.players.update(id, { status });
    return this.findOne(id);
  }

  async addComment(id: string, body: string, authorId?: string) {
    await this.findOne(id);
    const comment = await this.comments.save(
      this.comments.create({ playerId: id, body, authorId: authorId ?? undefined }),
    );
    return comment;
  }

  /** Enrolment history — never destroyed when team/season changes. */
  async history(id: string) {
    await this.findOne(id);
    return this.enrolments.find({
      where: { playerId: id },
      relations: { season: true, term: true, team: true },
      order: { enrolledAt: 'DESC' },
    });
  }

  async remove(id: string) {
    const player = await this.findOne(id);
    await this.players.update(id, { status: PlayerStatus.WITHDRAWN });
    return { success: true, id: player.id, status: PlayerStatus.WITHDRAWN };
  }
}
