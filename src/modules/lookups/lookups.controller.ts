import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import { LookupsService } from './lookups.service.js';
import { CompanyAccess } from '../../common/decorators/account-scope.decorator.js';
import { Permission, AnyStaff } from '../../common/decorators/permission.decorator.js';

@Controller('lookups')
export class LookupsController {
  constructor(
    private readonly lookupsService: LookupsService,
  ) {}

  // Dropdown labels (units, receipt types…) are needed to show invoices in the company portal too.
  @AnyStaff()
  @CompanyAccess()
  @Get()
  async getLookups() {
    return this.lookupsService.getLookups();
  }

  @Permission(['lookups', 'edit'])
  @Post(':list')
  async addLookup(
    @Param('list') list: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lookupsService.addLookup(list, body);
  }

  @Permission(['lookups', 'edit'])
  @Put(':list/:value')
  async renameLookup(
    @Param('list') list: string,
    @Param('value') value: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lookupsService.renameLookup(list, value, body);
  }

  @Permission(['lookups', 'edit'])
  @Post(':list/:value/move')
  @Patch(':list/:value/move')
  async moveLookup(
    @Param('list') list: string,
    @Param('value') value: string,
    @Body() body: { dir: 'up' | 'down' },
  ) {
    return this.lookupsService.moveLookup(
      list,
      value,
      body.dir,
    );
  }

  @Permission(['lookups', 'edit'])
  @Delete(':list/:value')
  async deleteLookup(
    @Param('list') list: string,
    @Param('value') value: string,
  ) {
    return this.lookupsService.deleteLookup(list, value);
  }
}

