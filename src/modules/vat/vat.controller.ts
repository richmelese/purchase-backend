import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { VatService } from './vat.service.js';
import { currentFiscalYear } from '../../common/lib/ethiopian.js';
import { Permission, AnyStaff } from '../../common/decorators/permission.decorator.js';

@Controller('vat')
export class VatController {
  constructor(private readonly vatService: VatService) {}

  @Permission(['vat', 'view'])
  @Get()
  async getVat(@Query('fy') fy?: string) {
    const year = +fy || currentFiscalYear();
    return this.vatService.vatDeclaration(year);
  }

  @Permission(['vat', 'edit'])
  @Put('adjustments')
  async saveAdjustments(@Body() body: any) {
    return this.vatService.saveVatAdjustments(+body.fy, body.items || []);
  }
}

@Controller('fiscal-years')
export class FiscalYearsController {
  constructor(private readonly vatService: VatService) {}

  @Get()
  @AnyStaff()
  async getFiscalYears() {
    return this.vatService.getFiscalYears();
  }
}
