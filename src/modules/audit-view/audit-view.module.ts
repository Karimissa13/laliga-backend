import { Module } from '@nestjs/common';
import { AuditViewController } from './audit-view.controller';

@Module({ controllers: [AuditViewController] })
export class AuditViewModule {}
