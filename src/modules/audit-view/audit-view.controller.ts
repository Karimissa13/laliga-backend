import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../audit/audit.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Audit Log')
@Controller('audit-logs')
export class AuditViewController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Query the activity/audit log' })
  find(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.find({ entity, entityId, actorId, action, take: 100 });
  }
}
