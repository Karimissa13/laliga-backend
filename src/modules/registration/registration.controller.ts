import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistrationService } from './registration.service';
import { EnrolmentService } from './enrolment.service';
import { EnrolDto, RegisterPlayerDto, RenewDto } from './dto/registration.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Registration & Trials')
@Controller()
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly enrolment: EnrolmentService,
  ) {}

  // ---- One-flow registration ----
  @Post('register') @RequirePermissions('registration.create') @Audit('registration.register', 'player')
  @ApiOperation({ summary: 'Register a player end-to-end: guardian → player → (optional) enrolment' })
  register(@Body() dto: RegisterPlayerDto) { return this.registration.register(dto); }

  // ---- Enrolment / renewals ----
  @Post('enrolments') @RequirePermissions('registration.create') @Audit('enrolment.create', 'enrolment')
  @ApiOperation({ summary: 'Enrol a player into a term/team (waitlists if the team is full)' })
  enrol(@Body() dto: EnrolDto) { return this.enrolment.enrol(dto); }
  @Post('enrolments/renew') @RequirePermissions('registration.create') @Audit('enrolment.renew', 'enrolment')
  @ApiOperation({ summary: 'Renew a player into a new term' })
  renew(@Body() dto: RenewDto) { return this.enrolment.renew(dto); }
  @Get('players/:id/enrolments') @RequirePermissions('player.view')
  history(@Param('id') id: string) { return this.enrolment.history(id); }
}
