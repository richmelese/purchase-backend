import { Module } from '@nestjs/common';
import { ImportExportService } from './import-export.service.js';
import { ImportExportController } from './import-export.controller.js';
import { SettingsModule } from '../settings/settings.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { ProductsModule } from '../products/products.module.js';
import { VatModule } from '../vat/vat.module.js';
import { WithholdingModule } from '../withholding/withholding.module.js';
import { CreditModule } from '../credit/credit.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { LookupsModule } from '../lookups/lookups.module.js';

@Module({
  imports: [
    SettingsModule,
    InvoicesModule,
    ProductsModule,
    VatModule,
    WithholdingModule,
    CreditModule,
    InventoryModule,
    ReportsModule,
    LookupsModule,
  ],
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
