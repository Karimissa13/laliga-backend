import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AcademyEvent, AcademyEventKind } from '../../database/entities';

/** Pitch bookings, matches, tournaments and holidays shown on the dashboard timeline. */
@Injectable()
export class AcademyCalendarService {
  constructor(@InjectRepository(AcademyEvent) private readonly events: Repository<AcademyEvent>) {}

  list(q: { seasonId?: string; from?: string; to?: string; kind?: AcademyEventKind; locationId?: string }) {
    const qb = this.events.createQueryBuilder('e').leftJoinAndSelect('e.location', 'l').orderBy('e.startDate', 'ASC');
    if (q.seasonId) qb.andWhere('(e.seasonId = :s OR e.seasonId IS NULL)', { s: q.seasonId });
    if (q.from) qb.andWhere('e.endDate >= :f', { f: q.from });
    if (q.to) qb.andWhere('e.startDate <= :t', { t: q.to });
    if (q.kind) qb.andWhere('e.kind = :k', { k: q.kind });
    if (q.locationId) qb.andWhere('(e.locationId = :l OR e.locationId IS NULL)', { l: q.locationId });
    return qb.getMany();
  }

  private check(d: { startDate?: string; endDate?: string }) {
    if (d.startDate && d.endDate && d.endDate < d.startDate) throw new BadRequestException('The end date is before the start date');
  }

  async create(dto: Partial<AcademyEvent>) {
    this.check(dto);
    return this.events.save(this.events.create({ ...dto, endDate: dto.endDate ?? dto.startDate }));
  }

  async update(id: string, dto: Partial<AcademyEvent>) {
    const e = await this.events.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Calendar entry not found');
    Object.assign(e, dto);
    this.check(e);
    return this.events.save(e);
  }

  /** Removes a calendar entry made by mistake. Recorded in the activity log. */
  async remove(id: string) {
    const e = await this.events.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Calendar entry not found');
    await this.events.delete(id);
    return { id, removed: true, title: e.title };
  }
}
