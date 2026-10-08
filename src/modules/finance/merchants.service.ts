import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Merchant, PaymentMethod } from '../../database/entities';

/** Card acquirers and payment-link providers, with their merchant IDs. */
@Injectable()
export class MerchantsService {
  constructor(@InjectRepository(Merchant) private readonly merchants: Repository<Merchant>) {}

  list(activeOnly = false) {
    return this.merchants.find({ where: activeOnly ? { isActive: true } : {}, order: { name: 'ASC' } });
  }

  async create(dto: { name: string; merchantNumber: string; methods?: PaymentMethod[]; locationId?: string | null }) {
    if (await this.merchants.findOne({ where: { name: dto.name } })) throw new BadRequestException(`${dto.name} already exists`);
    return this.merchants.save(this.merchants.create({ ...dto, methods: dto.methods ?? [] }));
  }

  async update(id: string, dto: Partial<Merchant>) {
    const m = await this.merchants.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Merchant not found');
    Object.assign(m, dto);
    return this.merchants.save(m);
  }
}
