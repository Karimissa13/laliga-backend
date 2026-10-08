import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgeGroup, Location, Season, Term, Venue } from '../../database/entities';

/** Config/reference data: seasons & terms, locations & venues, age groups. */
@Injectable()
export class StructureService {
  constructor(
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Location) private readonly locations: Repository<Location>,
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
    @InjectRepository(AgeGroup) private readonly ageGroups: Repository<AgeGroup>,
  ) {}

  // ---- Seasons ----
  listSeasons() { return this.seasons.find({ relations: { terms: true }, order: { name: 'ASC' } }); }

  async getSeason(id: string) {
    const s = await this.seasons.findOne({ where: { id }, relations: { terms: true } });
    if (!s) throw new NotFoundException('Season not found');
    return s;
  }

  async createSeason(input: Partial<Season>) {
    if (await this.seasons.findOne({ where: { name: input.name } })) {
      throw new BadRequestException('A season with this name already exists');
    }
    // Only one active season at a time.
    if (input.isActive) await this.seasons.update({}, { isActive: false });
    return this.seasons.save(this.seasons.create(input));
  }

  async updateSeason(id: string, input: Partial<Season>) {
    await this.getSeason(id);
    if (input.isActive) await this.seasons.update({}, { isActive: false });
    await this.seasons.update(id, input);
    return this.getSeason(id);
  }

  async activateSeason(id: string) {
    await this.getSeason(id);
    await this.seasons.update({}, { isActive: false });
    await this.seasons.update(id, { isActive: true });
    return this.getSeason(id);
  }

  // ---- Terms ----
  async createTerm(input: Partial<Term> & { seasonId: string }) {
    await this.getSeason(input.seasonId);
    return this.terms.save(this.terms.create(input));
  }
  async updateTerm(id: string, input: Partial<Term>) {
    const t = await this.terms.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Term not found');
    await this.terms.update(id, input);
    return this.terms.findOne({ where: { id } });
  }
  listTerms(seasonId?: string) {
    return this.terms.find({ where: seasonId ? { seasonId } : {}, relations: { season: true }, order: { startDate: 'ASC' } });
  }

  // ---- Locations & venues ----
  listLocations() { return this.locations.find({ relations: { venues: true }, order: { name: 'ASC' } }); }
  async createLocation(input: Partial<Location>) {
    if (await this.locations.findOne({ where: { name: input.name } })) {
      throw new BadRequestException('A location with this name already exists');
    }
    return this.locations.save(this.locations.create(input));
  }
  async updateLocation(id: string, input: Partial<Location>) {
    const l = await this.locations.findOne({ where: { id } });
    if (!l) throw new NotFoundException('Location not found');
    await this.locations.update(id, input);
    return this.locations.findOne({ where: { id } });
  }
  async createVenue(input: { locationId: string; name: string }) {
    const l = await this.locations.findOne({ where: { id: input.locationId } });
    if (!l) throw new BadRequestException('Invalid locationId');
    return this.venues.save(this.venues.create(input));
  }

  // ---- Age groups ----
  listAgeGroups() { return this.ageGroups.find({ order: { code: 'ASC' } }); }
  async createAgeGroup(input: Partial<AgeGroup>) {
    if (await this.ageGroups.findOne({ where: { code: input.code } })) {
      throw new BadRequestException('An age group with this code already exists');
    }
    return this.ageGroups.save(this.ageGroups.create(input));
  }
  async updateAgeGroup(id: string, input: Partial<AgeGroup>) {
    const a = await this.ageGroups.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Age group not found');
    await this.ageGroups.update(id, input);
    return this.ageGroups.findOne({ where: { id } });
  }
}
