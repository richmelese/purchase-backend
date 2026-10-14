import { Controller, Get, Post, Delete, Body, Param, Query, HttpCode } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

@Controller('issues')
export class IssuesController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Permission(['inventory', 'view'])
  @Get()
  async listIssues() {
    return this.inventoryService.listIssues();
  }

  @Permission(['inventory', 'create'])
  @Post()
  async createIssue(@Body() body: any) {
    return this.inventoryService.createIssue(body);
  }

  @Permission(['inventory', 'delete'])
  @Delete(':id')
  @HttpCode(204)
  async deleteIssue(@Param('id') id: string) {
    await this.inventoryService.deleteIssue(+id);
  }
}

@Controller('stock')
export class StockController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Permission(['inventory', 'view'])
  @Get('in')
  async getStockIn(@Query() query: any) {
    return this.inventoryService.stockIn(query);
  }

  @Permission(['inventory', 'view'])
  @Get('out')
  async getStockOut(@Query() query: any) {
    return this.inventoryService.stockOut(query);
  }
}
