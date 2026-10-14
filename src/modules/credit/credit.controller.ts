import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { CreditService } from './credit.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

function kindOf(kind: string): 'P' | 'S' {
  if (kind === 'purchases') return 'P';
  if (kind === 'sales') return 'S';
  throw new NotFoundException('Unknown resource');
}

@Controller('credit')
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @Permission(['credit', 'view'])
  @Get(':kind')
  async getCredit(@Param('kind') kind: string, @CurrentUser() user: any, @Query('all') all?: string) {
    const k = kindOf(kind);
    return this.creditService.creditReport({ kind: k, open: all !== '1' }, user);
  }
}
