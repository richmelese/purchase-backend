import { Module } from '@nestjs/common';
import { WithholdingService } from './withholding.service.js';
import { WithholdingController } from './withholding.controller.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [InvoicesModule],
  controllers: [WithholdingController],
  providers: [WithholdingService],
  exports: [WithholdingService],
})
export class WithholdingModule {}
