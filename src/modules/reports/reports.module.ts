import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { ReportsController, DashboardController } from './reports.controller.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { ProductsModule } from '../products/products.module.js';
import { VatModule } from '../vat/vat.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WithholdingModule } from '../withholding/withholding.module.js';
import { CreditModule } from '../credit/credit.module.js';

@Module({
  imports: [
    InvoicesModule,
    ProductsModule,
    VatModule,
    SettingsModule,
    WithholdingModule,
    CreditModule,
  ],
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
