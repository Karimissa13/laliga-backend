import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';
import {
  Attendance, Player, Session, SessionType, Team, Term,
} from '../../database/entities';

export interface SessionConflict {
  type: 'VENUE' | 'COACH' | 'TEAM';
  message: string;
  sessionId: string;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Attendance) private readonly attendances: Repository<Attendance>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
  ) {}

  /**
   * Detect double-bookings for a proposed slot. The legacy system had no concept
   * of dated sessions at all, so nothing prevented booking one pitch twice.
   */
  async findConflicts(input: {
    startsAt: Date; endsAt: Date; venueId?: string; coachId?: string; teamId?: string; excludeId?: string;
  }): Promise<SessionConflict[]> {
    const qb = this.sessions.createQueryBuilder('s')
      // overlap test: existing.start < new.end AND existing.end > new.start
      .where('s.startsAt < :end AND s.endsAt > :start', { start: input.startsAt, end: input.endsAt });
    if (input.excludeId) qb.andWhere('s.id != :ex', { ex: input.excludeId });

    const overlapping = await qb.getMany();
    const conflicts: SessionConflict[] = [];
    for (const s of overlapping) {
      if (input.venueId && s.venueId === input.venueId) {
        conflicts.push({ type: 'VENUE', sessionId: s.id, message: `Venue already booked ${s.startsAt.toISOString()} – ${s.endsAt.toISOString()}` });
      }
      if (input.coachId && s.coachId === input.coachId) {
        conflicts.push({ type: 'COACH', sessionId: s.id, message: `Coach already assigned to another session in this slot` });
      }
      if (input.teamId && s.teamId === input.teamId) {
        conflicts.push({ type: 'TEAM', sessionId: s.id, message: `Team already has a session in this slot` });
      }
    }
    return conflicts;
  }

  async list(filter: {
    from?: string; to?: string; teamId?: string; coachId?: string; locationId?: string; type?: SessionType;
  }) {
    const qb = this.sessions.createQueryBuilder('s')
      .leftJoinAndSelect('s.team', 't')
      .leftJoinAndSelect('s.location', 'l')
      .leftJoinAndSelect('s.venue', 'v')
      .leftJoinAndSelect('s.coach', 'c')
      .leftJoinAndSelect('c.user', 'cu')
      .leftJoinAndSelect('s.term', 'tm')
      .orderBy('s.startsAt', 'ASC');
    if (filter.from) qb.andWhere('s.startsAt >= :from', { from: new Date(filter.from) });
    if (filter.to) qb.andWhere('s.startsAt <= :to', { to: new Date(filter.to) });
    if (filter.teamId) qb.andWhere('s.teamId = :tid', { tid: filter.teamId });
    if (filter.coachId) qb.andWhere('s.coachId = :cid', { cid: filter.coachId });
    if (filter.locationId) qb.andWhere('s.locationId = :lid', { lid: filter.locationId });
    if (filter.type) qb.andWhere('s.type = :ty', { ty: filter.type });
    return qb.getMany();
  }

  async findOne(id: string) {
    const s = await this.sessions.findOne({
      where: { id },
      relations: { team: true, location: true, venue: true, coach: { user: true }, term: true },
    });
    if (!s) throw new NotFoundException('Session not found');
    return s;
  }

  async create(input: Partial<Session> & { startsAt: string | Date; endsAt: string | Date; force?: boolean }) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');

    const conflicts = await this.findConflicts({
      startsAt, endsAt, venueId: input.venueId, coachId: input.coachId, teamId: input.teamId,
    });
    if (conflicts.length && !input.force) {
      throw new BadRequestException({
        message: 'Scheduling conflict detected', error: 'ScheduleConflict', conflicts,
      });
    }
    const { force, ...rest } = input as any;
    const saved = await this.sessions.save(this.sessions.create({ ...rest, startsAt, endsAt }));
    return this.findOne((saved as any).id);
  }

  async update(id: string, input: any) {
    const existing = await this.findOne(id);
    const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : existing.endsAt;
    const conflicts = await this.findConflicts({
      startsAt, endsAt,
      venueId: input.venueId ?? existing.venueId,
      coachId: input.coachId ?? existing.coachId,
      teamId: input.teamId ?? existing.teamId,
      excludeId: id,
    });
    if (conflicts.length && !input.force) {
      throw new BadRequestException({ message: 'Scheduling conflict detected', error: 'ScheduleConflict', conflicts });
    }
    const { force, ...rest } = input;
    await this.sessions.update(id, { ...rest, startsAt, endsAt });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.sessions.delete(id);
    return { success: true, id };
  }

  /**
   * Bulk-generate recurring sessions across a term — e.g. "U12 train Mon/Wed/Fri
   * 18:00–19:30 for all of Term 1". Replaces hand-entering every session.
   */
  async generateForTerm(input: {
    termId: string; teamId?: string; locationId?: string; venueId?: string; coachId?: string;
    weekdays: number[]; // 0=Sun … 6=Sat
    startTime: string; // "18:00"
    endTime: string;   // "19:30"
    type?: SessionType;
    skipConflicts?: boolean;
  }) {
    const term = await this.terms.findOne({ where: { id: input.termId } });
    if (!term) throw new BadRequestException('Invalid termId');
    if (!term.startDate || !term.endDate) throw new BadRequestException('Term has no start/end date');

    const [sh, sm] = input.startTime.split(':').map(Number);
    const [eh, em] = input.endTime.split(':').map(Number);
    const created: Session[] = [];
    const skipped: { date: string; conflicts: SessionConflict[] }[] = [];

    const cur = new Date(term.startDate);
    const end = new Date(term.endDate);
    while (cur <= end) {
      if (input.weekdays.includes(cur.getDay())) {
        const startsAt = new Date(cur); startsAt.setHours(sh, sm, 0, 0);
        const endsAt = new Date(cur); endsAt.setHours(eh, em, 0, 0);
        const conflicts = await this.findConflicts({
          startsAt, endsAt, venueId: input.venueId, coachId: input.coachId, teamId: input.teamId,
        });
        if (conflicts.length) {
          skipped.push({ date: startsAt.toISOString(), conflicts });
        } else {
          const s = await this.sessions.save(this.sessions.create({
            termId: input.termId, teamId: input.teamId, locationId: input.locationId,
            venueId: input.venueId, coachId: input.coachId,
            type: input.type ?? SessionType.TRAINING,
            startsAt, endsAt,
          }));
          created.push(s);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return { createdCount: created.length, skippedCount: skipped.length, skipped, created };
  }

  /** Sessions happening today / upcoming — powers the dashboard widget. */
  async upcoming(days = 2) {
    const from = new Date();
    const to = new Date(); to.setDate(to.getDate() + days);
    return this.sessions.find({
      where: { startsAt: Between(from, to) },
      relations: { team: true, venue: true, location: true, coach: { user: true } },
      order: { startsAt: 'ASC' },
      take: 50,
    });
  }
}
