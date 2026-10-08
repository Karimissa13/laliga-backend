import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuardiansService } from './guardians.service';
import { CreateGuardianDto, GuardianDirectoryDto, UpdateGuardianDto } from './dto/guardian.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Guardians')
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'List guardians (paginated, searchable) with player counts' })
  list(@Query() q: PaginationDto) { return this.guardians.list(q); }

  @Get('directory')
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'Guardians screen: search by name, email, additional email, mobile, child; filter by PR number, emirate, children, portal' })
  async directory(@Query() q: GuardianDirectoryDto, @CurrentUser() u: AuthUser) {
    const r: any = await this.guardians.directory(q);
    const wallet = u?.permissions?.includes('*') || u?.permissions?.includes('wallet.view');
    if (!wallet) r.data = r.data.map((x: any) => ({ ...x, wallet: null }));
    return r;
  }

  @Get(':id')
  @RequirePermissions('guardian.view')
  findOne(@Param('id') id: string) { return this.guardians.findOne(id); }

  @Get(':id/siblings')
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'Players (siblings) under this guardian' })
  siblings(@Param('id') id: string) { return this.guardians.siblings(id); }

  @Post()
  @RequirePermissions('guardian.create')
  @Audit('guardian.create', 'guardian')
  @ApiOperation({ summary: 'Create a guardian (auto-creates wallet)' })
  create(@Body() dto: CreateGuardianDto) { return this.guardians.create(dto); }

  @Patch(':id')
  @RequirePermissions('guardian.edit')
  @Audit('guardian.update', 'guardian')
  update(@Param('id') id: string, @Body() dto: UpdateGuardianDto) {
    return this.guardians.update(id, dto as any);
  }
}
