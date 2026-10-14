import { Module } from '@nestjs/common';
import { OrmModule } from '../../orm/orm.module.js';
import { AuditLogEntity } from '../../entities/audit-log.entity.js';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Module({
  imports: [OrmModule.forFeature([AuditLogEntity])],
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
