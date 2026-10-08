import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coach, User } from '../../database/entities';

@Injectable()
export class CoachesService {
  constructor(
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  list() {
    return this.coaches.find({ relations: { user: true }, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string) {
    const coach = await this.coaches.findOne({ where: { id }, relations: { user: true } });
    if (!coach) throw new NotFoundException('Coach not found');
    return coach;
  }

  /** Attach a coach profile to an existing staff user. */
  async create(input: { userId: string; certification?: string; bio?: string }) {
    const user = await this.users.findOne({ where: { id: input.userId } });
    if (!user) throw new BadRequestException('Invalid userId');
    if (await this.coaches.findOne({ where: { userId: input.userId } })) {
      throw new BadRequestException('This user already has a coach profile');
    }
    const coach = await this.coaches.save(this.coaches.create(input));
    return this.findOne(coach.id);
  }

  async update(id: string, input: Partial<Coach>) {
    await this.findOne(id);
    await this.coaches.update(id, input);
    return this.findOne(id);
  }
}
