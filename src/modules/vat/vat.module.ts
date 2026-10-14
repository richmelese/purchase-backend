import { Module } from '@nestjs/common';
import { VatService } from './vat.service.js';
import { VatController, FiscalYearsController } from './vat.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { VatAdjustmentEntity } from '../../entities/vat-adjustment.entity.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';

@Module({
  imports: [OrmModule.forFeature([VatAdjustmentEntity, InvoiceEntity])],
  controllers: [VatController, FiscalYearsController],
  providers: [VatService],
  exports: [VatService],
})
export class VatModule {}
