import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StructureService } from './structure.service';
import {
  CreateAgeGroupDto, CreateLocationDto, CreateSeasonDto, CreateTermDto, CreateVenueDto,
  UpdateAgeGroupDto, UpdateLocationDto, UpdateSeasonDto, UpdateTermDto,
} from './dto/structure.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Structure — Seasons, Terms, Locations, Age Groups')
@Controller()
export class StructureController {
  constructor(private readonly s: StructureService) {}

  // Seasons
  @Get('seasons') @RequirePermissions('season.view')
  listSeasons() { return this.s.listSeasons(); }
  @Get('seasons/:id') @RequirePermissions('season.view')
  getSeason(@Param('id') id: string) { return this.s.getSeason(id); }
  @Post('seasons') @RequirePermissions('season.create') @Audit('season.create', 'season')
  createSeason(@Body() dto: CreateSeasonDto) { return this.s.createSeason(dto); }
  @Patch('seasons/:id') @RequirePermissions('season.edit') @Audit('season.update', 'season')
  updateSeason(@Param('id') id: string, @Body() dto: UpdateSeasonDto) { return this.s.updateSeason(id, dto); }
  @Patch('seasons/:id/activate') @RequirePermissions('season.edit') @Audit('season.activate', 'season')
  @ApiOperation({ summary: 'Make this the active season (deactivates others)' })
  activateSeason(@Param('id') id: string) { return this.s.activateSeason(id); }

  // Terms
  @Get('terms') @RequirePermissions('season.view')
  listTerms(@Query('seasonId') seasonId?: string) { return this.s.listTerms(seasonId); }
  @Post('terms') @RequirePermissions('season.create') @Audit('term.create', 'term')
  createTerm(@Body() dto: CreateTermDto) { return this.s.createTerm(dto); }
  @Patch('terms/:id') @RequirePermissions('season.edit') @Audit('term.update', 'term')
  updateTerm(@Param('id') id: string, @Body() dto: UpdateTermDto) { return this.s.updateTerm(id, dto); }

  // Locations & venues
  @Get('locations') @RequirePermissions('location.view')
  listLocations() { return this.s.listLocations(); }
  @Post('locations') @RequirePermissions('location.create') @Audit('location.create', 'location')
  createLocation(@Body() dto: CreateLocationDto) { return this.s.createLocation(dto); }
  @Patch('locations/:id') @RequirePermissions('location.edit') @Audit('location.update', 'location')
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) { return this.s.updateLocation(id, dto); }
  @Post('venues') @RequirePermissions('location.create') @Audit('venue.create', 'venue')
  createVenue(@Body() dto: CreateVenueDto) { return this.s.createVenue(dto); }

  // Age groups
  @Get('age-groups') @RequirePermissions('agegroup.view')
  listAgeGroups() { return this.s.listAgeGroups(); }
  @Post('age-groups') @RequirePermissions('agegroup.create') @Audit('agegroup.create', 'agegroup')
  createAgeGroup(@Body() dto: CreateAgeGroupDto) { return this.s.createAgeGroup(dto); }
  @Patch('age-groups/:id') @RequirePermissions('agegroup.edit') @Audit('agegroup.update', 'agegroup')
  updateAgeGroup(@Param('id') id: string, @Body() dto: UpdateAgeGroupDto) { return this.s.updateAgeGroup(id, dto); }
}
