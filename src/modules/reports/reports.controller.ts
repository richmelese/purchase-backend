import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { currentFiscalYear } from '../../common/lib/ethiopian.js';
import { Permission } from '../../common/decorators/permission.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

function kindOf(kind: string): 'P' | 'S' {
  if (kind === 'purchases') return 'P';
  if (kind === 'sales') return 'S';
  throw new NotFoundException('Unknown resource');
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly reportsService: ReportsService) {}

  @Permission(['reports', 'view'])
  @Get()
  async getDashboard(@CurrentUser() user: any, @Query('fy') fy?: string) {
    const year = +fy || currentFiscalYear();
    return this.reportsService.dashboard(year, user);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Permission(['reports', 'view'])
  @Get('monthly')
  async getMonthly(@CurrentUser() user: any, @Query('fy') fy?: string) {
    const year = +fy || currentFiscalYear();
    return this.reportsService.monthlySummary(year, user);
  }

  @Permission(['reports', 'view'])
  @Get('products')
  async getProducts(@CurrentUser() user: any, @Query('fy') fy?: string, @Query('month') month?: string) {
    const year = +fy || currentFiscalYear();
    return this.reportsService.salesByProduct({ fy: year, month }, user);
  }

  @Permission(['reports', 'view'])
  @Get('parties/:kind')
  async getParties(
    @Param('kind') kind: string,
    @Query('fy') fy?: string,
    @Query('month') month?: string,
    @CurrentUser() user?: any,
  ) {
    const k = kindOf(kind);
    const year = +fy || currentFiscalYear();
    return this.reportsService.partyTotals(k, { fy: year, month }, user);
  }
}
