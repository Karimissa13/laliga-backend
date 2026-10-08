import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role, User } from '../../database/entities';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
  ) {}

  async list(q: PaginationDto) {
    const where = q.search
      ? [{ fullName: ILike(`%${q.search}%`) }, { email: ILike(`%${q.search}%`) }]
      : {};
    const [data, total] = await this.users.findAndCount({
      where: where as any,
      relations: { role: true },
      order: { createdAt: 'DESC' },
      skip: q.skip, take: q.limit,
    });
    return paginate(data, total, q.page, q.limit);
  }

  async findOne(id: string) {
    const user = await this.users.findOne({ where: { id }, relations: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async roleOrFail(roleId: string): Promise<Role> {
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role) throw new BadRequestException('Invalid roleId');
    return role;
  }

  async create(input: { fullName: string; email: string; mobile?: string; password: string; roleId: string }) {
    if (await this.users.findOne({ where: { email: input.email.toLowerCase() } })) {
      throw new BadRequestException('Email already in use');
    }
    await this.roleOrFail(input.roleId);
    const user = this.users.create({
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      mobile: input.mobile,
      passwordHash: await bcrypt.hash(input.password, 10),
      roleId: input.roleId,
    });
    const saved = await this.users.save(user);
    return this.findOne(saved.id);
  }

  async update(id: string, input: { fullName?: string; mobile?: string; roleId?: string; isActive?: boolean; password?: string }) {
    const user = await this.findOne(id);
    if (input.roleId) await this.roleOrFail(input.roleId);
    const patch: Partial<User> = {
      fullName: input.fullName ?? user.fullName,
      mobile: input.mobile ?? user.mobile,
      roleId: input.roleId ?? user.roleId,
      isActive: input.isActive ?? user.isActive,
    };
    if (input.password) patch.passwordHash = await bcrypt.hash(input.password, 10);
    await this.users.update(id, patch);
    return this.findOne(id);
  }

  async remove(id: string) {
    const user = await this.findOne(id);
    // Soft-deactivate rather than hard-delete to preserve audit/history references.
    await this.users.update(id, { isActive: false });
    return { success: true, id: user.id, deactivated: true };
  }
}
