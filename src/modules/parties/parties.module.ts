import { Module } from '@nestjs/common';
import { PartiesService } from './parties.service.js';
import { PartiesController } from './parties.controller.js';
import { CompanyAccountsService } from './company-accounts.service.js';
import { OrmModule } from '../../orm/orm.module.js';
import { PartyEntity } from '../../entities/party.entity.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { PaymentEntity } from '../../entities/payment.entity.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [
    OrmModule.forFeature([PartyEntity, InvoiceEntity, PaymentEntity]),
    SettingsModule,
  ],
  controllers: [PartiesController],
  providers: [PartiesService, CompanyAccountsService],
  exports: [PartiesService, CompanyAccountsService],
})
export class PartiesModule {}
