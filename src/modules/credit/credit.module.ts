import { Module } from '@nestjs/common';
import { CreditService } from './credit.service.js';
import { CreditController } from './credit.controller.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [InvoicesModule],
  controllers: [CreditController],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
