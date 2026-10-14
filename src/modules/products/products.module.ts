import { Module } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { ProductsController } from './products.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { ProductEntity } from '../../entities/product.entity.js';
import { LookupsModule } from '../lookups/lookups.module.js';

@Module({
  imports: [OrmModule.forFeature([ProductEntity]), LookupsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
