import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { WithholdingService } from './withholding.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

function kindOf(kind: string): 'P' | 'S' {
  if (kind === 'purchases') return 'P';
  if (kind === 'sales') return 'S';
  throw new NotFoundException('Unknown resource');
}

@Controller('withholding')
export class WithholdingController {
  constructor(private readonly withholdingService: WithholdingService) {}

  @Permission(['withholding', 'view'])
  @Get(':kind')
  async getWithholding(
    @Param('kind') kind: string,
    @Query('fy') fy?: string,
    @Query('month') month?: string,
    @Query('all') all?: string,
    @CurrentUser() user?: any,
  ) {
    const k = kindOf(kind);
    return this.withholdingService.withholdingReport({
      kind: k,
      fy,
      month,
      onlyApplicable: all !== '1',
    }, user);
  }
}
