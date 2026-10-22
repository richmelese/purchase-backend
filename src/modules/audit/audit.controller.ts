import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AUDIT_ENTITIES, AuditService } from './audit.service.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

@Controller('audit')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Permission(['audit', 'view'])
  @Get('entities')
  entities() {
    return AUDIT_ENTITIES;
  }

  @Permission(['audit', 'view'])
  @Get()
  async list(@Query() query: any) {
    return this.auditService.listAudit(query);
  }
}
