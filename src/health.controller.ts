import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness + DB connectivity check' })
  async health() {
    let db = 'down';
    try { await this.ds.query('SELECT 1'); db = 'up'; } catch { /* down */ }
    return { status: 'ok', db, timestamp: new Date().toISOString() };
  }
}
