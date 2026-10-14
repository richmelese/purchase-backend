import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { IssuesController, StockController } from './inventory.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { StockIssueEntity } from '../../entities/stock-issue.entity.js';
import { ProductsModule } from '../products/products.module.js';

@Module({
  imports: [OrmModule.forFeature([StockIssueEntity]), ProductsModule],
  controllers: [IssuesController, StockController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
