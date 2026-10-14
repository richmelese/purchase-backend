import { Module } from '@nestjs/common';
import { LookupsService } from './lookups.service.js';
import { LookupsController } from './lookups.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { LookupEntity } from '../../entities/lookup.entity.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { InvoiceLineEntity } from '../../entities/invoice-line.entity.js';
import { ProductEntity } from '../../entities/product.entity.js';
import { StockIssueEntity } from '../../entities/stock-issue.entity.js';
import { PaymentEntity } from '../../entities/payment.entity.js';

@Module({
  imports: [
    OrmModule.forFeature([
      LookupEntity,
      InvoiceEntity,
      InvoiceLineEntity,
      ProductEntity,
      StockIssueEntity,
      PaymentEntity,
    ]),
  ],
  controllers: [LookupsController],
  providers: [LookupsService],
  exports: [LookupsService],
})
export class LookupsModule {}
