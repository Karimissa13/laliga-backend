import { seesMoney } from '../../common/money-visibility';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlayerDeskService } from './player-desk.service';
import {
  AddItemsDto, AddTermDto, AssignCoachDto, EligibleTeamsQueryDto, FamilyQuoteDto, FamilyTermsDto, GuardianLookupDto, OptionalReasonDto,
  NewChildQuoteDto, PlacementQueryDto, QuoteQueryDto, ReasonDto, RegistrationOptionsDto,
} from './dto/player-desk.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Player desk')
@Controller()
export class PlayerDeskController {
  constructor(private readonly desk: PlayerDeskService) {}

  @Get('players/:id/profile') @RequirePermissions('player.view')
  @ApiOperation({ summary: 'Everything the player page shows, in one call' })
  async profile(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const r: any = await this.desk.profile(id);
    if (seesMoney(u)) return r;
    // Coaches: the child, team, attendance and comments — no fees, invoices or wallet.
    return { ...r, invoices: [], payment: null, siblingCredits: [], siblingDiscount: null,
      guardian: { ...r.guardian, wallet: null }, moneyHidden: true };
  }

  @Get('players/:id/terms/quote') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Price of adding a term — list price, sibling discount, VAT — before anything is written' })
  quote(@Param('id') id: string, @Query() q: QuoteQueryDto) { return this.desk.quote(id, q); }

  @Post('players/:id/terms') @RequirePermissions('registration.create', 'invoice.create')
  @Audit('player.add_term', 'player')
  @ApiOperation({ summary: 'Enrol into a term and generate its invoice in one step' })
  addTerm(@Param('id') id: string, @Body() dto: AddTermDto, @CurrentUser() user: AuthUser) {
    return this.desk.addTerm(id, dto, user?.id);
  }

  @Post('players/:id/items') @RequirePermissions('invoice.create')
  @Audit('player.add_items', 'player')
  @ApiOperation({ summary: '"User term": add kits, a league or another item to a registered child, with its own invoice' })
  addItems(@Param('id') id: string, @Body() dto: AddItemsDto, @CurrentUser() user: AuthUser) {
    return this.desk.addItems(id, dto, user?.id);
  }

  @Post('players/:id/archive') @RequirePermissions('player.delete') @Audit('player.archive', 'player')
  @ApiOperation({ summary: 'Archive (the desk\'s "delete") — hides the child, keeps all history' })
  archive(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthUser) {
    return this.desk.archive(id, dto.reason, user?.id);
  }

  @Post('players/:id/restore') @RequirePermissions('player.delete') @Audit('player.restore', 'player')
  restore(@Param('id') id: string, @Body() dto: OptionalReasonDto, @CurrentUser() user: AuthUser) {
    return this.desk.restore(id, dto.reason, user?.id);
  }

  @Post('players/:id/delete-permanently') @RequirePermissions('player.manage') @Audit('player.delete_permanent', 'player')
  @ApiOperation({ summary: 'Remove a record created by mistake. Refused if the child has any history.' })
  deletePermanently(@Param('id') id: string, @Body() _dto: ReasonDto) { return this.desk.deletePermanently(id); }

  @Post('guardians/:id/account-view') @RequirePermissions('guardian.manage') @Audit('guardian.account_view', 'guardian')
  @ApiOperation({ summary: '"Account switch": read-only view of the parent\'s account. Reason required and logged.' })
  accountView(@Param('id') id: string, @Body() _dto: ReasonDto) { return this.desk.accountView(id); }

  @Patch('teams/:id/coach') @RequirePermissions('team.edit') @Audit('team.assign_coach', 'team')
  @ApiOperation({ summary: 'Assign the team\'s coach (applies to every child on the team)' })
  assignCoach(@Param('id') id: string, @Body() dto: AssignCoachDto) { return this.desk.assignTeamCoach(id, dto.coachId ?? null); }

  @Get('registration/placement') @RequirePermissions('player.view')
  @ApiOperation({ summary: 'Age category for a date of birth, including the play-up rule' })
  placement(@Query() q: PlacementQueryDto) { return this.desk.placement(q.dob); }

  @Get('registration/eligible-teams') @RequirePermissions('team.view')
  @ApiOperation({ summary: 'Teams that take a category, best level first, with places left' })
  eligibleTeams(@Query() q: EligibleTeamsQueryDto) { return this.desk.eligibleTeams(q); }

  @Get('registration/options') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Term options, sessions-a-week tiers and optional extras for a child' })
  options(@Query() q: RegistrationOptionsDto) { return this.desk.registrationOptions(q); }

  @Post('registration/family-quote') @RequirePermissions('invoice.view') @HttpCode(200)
  @ApiOperation({ summary: 'Price siblings being registered together (one family invoice, sibling ladder across them)' })
  quoteFamily(@Body() dto: FamilyQuoteDto) { return this.desk.quoteFamily(dto as any); }

  @Post('guardians/:id/terms') @RequirePermissions('registration.create', 'invoice.create')
  @Audit('guardian.family_terms', 'guardian')
  @ApiOperation({ summary: 'Enrol several children of one parent and raise ONE family invoice' })
  familyTerms(@Param('id') id: string, @Body() dto: FamilyTermsDto, @CurrentUser() user: AuthUser) {
    return this.desk.addFamilyTerms(id, dto as any, user?.id);
  }

  @Get('registration/quote') @RequirePermissions('invoice.view')
  @ApiOperation({ summary: 'Price a child being registered — before anything is saved' })
  quoteNew(@Query() q: NewChildQuoteDto) { return this.desk.quoteNew(q); }

  @Get('team-board') @RequirePermissions('team.view')
  @ApiOperation({ summary: 'Every active team with level, schedule, coach and places left — the schedule board' })
  teamBoard() { return this.desk.eligibleTeams({}); }

  @Get('registration/guardian-lookup') @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'Find an existing parent by phone, email, name or PR number' })
  guardianLookup(@Query() q: GuardianLookupDto) { return this.desk.guardianLookup(q.q); }
}
