import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { SettingsController, BackupController, CompanyProfileController } from './settings.controller.js';
import { CompanyProfileService } from './company-profile.service.js';
import { OrmModule } from '../../orm/orm.module.js';
import { SettingEntity } from '../../entities/setting.entity.js';

@Module({
  imports: [OrmModule.forFeature([SettingEntity])],
  controllers: [SettingsController, BackupController, CompanyProfileController],
  providers: [SettingsService, CompanyProfileService],
  exports: [SettingsService],
})
export class SettingsModule {}
