import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { PurchasesController, SalesController, PaymentsController } from './invoices.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { InvoiceLineEntity } from '../../entities/invoice-line.entity.js';
import { PaymentEntity } from '../../entities/payment.entity.js';
import { PartyEntity } from '../../entities/party.entity.js';
import { ProductEntity } from '../../entities/product.entity.js';
import { SettingsModule } from '../settings/settings.module.js';
import { LookupsModule } from '../lookups/lookups.module.js';

@Module({
  imports: [
    OrmModule.forFeature([
      InvoiceEntity,
      InvoiceLineEntity,
      PaymentEntity,
      PartyEntity,
      ProductEntity,
    ]),
    SettingsModule,
    LookupsModule,
  ],
  controllers: [PurchasesController, SalesController, PaymentsController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
