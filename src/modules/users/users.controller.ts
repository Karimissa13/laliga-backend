import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('Staff Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'List staff users (paginated, searchable)' })
  list(@Query() q: PaginationDto) { return this.users.list(q); }

  @Get(':id')
  @RequirePermissions('user.view')
  findOne(@Param('id') id: string) { return this.users.findOne(id); }

  @Post()
  @RequirePermissions('user.create')
  @Audit('user.create', 'user')
  @ApiOperation({ summary: 'Create a staff user with a role' })
  create(@Body() dto: CreateUserDto) { return this.users.create(dto); }

  @Patch(':id')
  @RequirePermissions('user.edit')
  @Audit('user.update', 'user')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) { return this.users.update(id, dto); }

  @Delete(':id')
  @RequirePermissions('user.delete')
  @Audit('user.deactivate', 'user')
  @ApiOperation({ summary: 'Deactivate a staff user (soft, preserves history)' })
  remove(@Param('id') id: string) { return this.users.remove(id); }
}
