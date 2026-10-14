import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { PartiesModule } from '../parties/parties.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [PartiesModule, InvoicesModule, SettingsModule],
  controllers: [PortalController],
})
export class PortalModule {}
