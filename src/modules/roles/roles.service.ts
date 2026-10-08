import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Permission, Role } from '../../database/entities';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
  ) {}

  findAll() {
    return this.roles.find({ relations: { permissions: true }, order: { name: 'ASC' } });
  }

  async findOne(id: string) {
    const role = await this.roles.findOne({ where: { id }, relations: { permissions: true } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  listPermissions() {
    return this.permissions.find({ order: { module: 'ASC', action: 'ASC' } });
  }

  private slugify(name: string) {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  private async resolvePermissions(keys: string[]): Promise<Permission[]> {
    if (!keys?.length) return [];
    const perms = await this.permissions.find({ where: { key: In(keys) } });
    const found = new Set(perms.map((p) => p.key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length) throw new BadRequestException(`Unknown permission(s): ${missing.join(', ')}`);
    return perms;
  }

  async create(input: { name: string; description?: string; permissionKeys: string[] }) {
    const slug = this.slugify(input.name);
    if (await this.roles.findOne({ where: { slug } })) {
      throw new BadRequestException('A role with this name already exists');
    }
    const role = this.roles.create({
      name: input.name, slug, description: input.description, isSystem: false,
      permissions: await this.resolvePermissions(input.permissionKeys),
    });
    return this.roles.save(role);
  }

  async updatePermissions(id: string, permissionKeys: string[]) {
    const role = await this.findOne(id);
    role.permissions = await this.resolvePermissions(permissionKeys);
    return this.roles.save(role);
  }

  async remove(id: string) {
    const role = await this.findOne(id);
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    await this.roles.remove(role);
    return { success: true };
  }
}
