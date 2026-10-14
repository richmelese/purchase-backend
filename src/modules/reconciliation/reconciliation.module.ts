import { Module } from '@nestjs/common';
import { OrmModule } from '../../orm/orm.module.js';
import { BankAccountEntity } from '../../entities/bank-account.entity.js';
import { BankTransactionEntity } from '../../entities/bank-transaction.entity.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationService } from './reconciliation.service.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [
    OrmModule.forFeature([BankAccountEntity, BankTransactionEntity]),
    InvoicesModule,
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
