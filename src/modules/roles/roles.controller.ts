import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRolePermissionsDto } from './dto/role.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Roles & Permissions')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'List every available permission (module.action)' })
  listPermissions() { return this.roles.listPermissions(); }

  @Get()
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'List roles with their permissions' })
  findAll() { return this.roles.findAll(); }

  @Get(':id')
  @RequirePermissions('role.view')
  findOne(@Param('id') id: string) { return this.roles.findOne(id); }

  @Post()
  @RequirePermissions('role.create')
  @Audit('role.create', 'role')
  @ApiOperation({ summary: 'Create a custom role' })
  create(@Body() dto: CreateRoleDto) { return this.roles.create({ ...dto }); }

  @Patch(':id/permissions')
  @RequirePermissions('role.manage')
  @Audit('role.update-permissions', 'role')
  updatePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto) {
    return this.roles.updatePermissions(id, dto.permissionKeys);
  }

  @Delete(':id')
  @RequirePermissions('role.delete')
  @Audit('role.delete', 'role')
  remove(@Param('id') id: string) { return this.roles.remove(id); }
}
