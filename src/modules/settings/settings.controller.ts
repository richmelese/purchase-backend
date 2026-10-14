import { Controller, Get, Put, Body, Res, ForbiddenException } from '@nestjs/common';
import { isAdmin } from '../../common/permissions.js';
import { Response } from 'express';
import { SettingsService } from './settings.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { CompanyProfileService, profileOptions } from './company-profile.service.js';
import { Permission, AnyStaff, CheckedInHandler } from '../../common/decorators/permission.decorator.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @AnyStaff() // tax rules and company name are needed by every form and printout
  async getSettings() {
    return this.settingsService.getSettings();
  }

  @Put()
  @Permission(['settings', 'edit'])
  async updateSettings(@Body() body: any) {
    return this.settingsService.updateSettings(body);
  }
}

@Controller('backup')
export class BackupController {
  constructor(private readonly settingsService: SettingsService) {}

  // The backup is the whole database (every company, user and password hash): administrators only,
  // whatever a role's export rights say.
  @Get()
  @CheckedInHandler()
  downloadBackup(@Res() res: Response, @CurrentUser() user: any) {
    if (!isAdmin(user)) {
      throw new ForbiddenException({ message: 'Only an administrator can download the database backup', code: 'NO_PERMISSION' });
    }
    this.settingsService.downloadBackup(res);
  }
}

@Controller('company-profile')
export class CompanyProfileController {
  constructor(private readonly profileService: CompanyProfileService) {}

  @Get()
  @Permission(['settings', 'view'])
  getProfile() {
    return { ...this.profileService.getProfile(), options: profileOptions() };
  }

  @Put()
  @Permission(['settings', 'edit'])
  updateProfile(@Body() body: any, @CurrentUser() user: any) {
    return { ...this.profileService.updateProfile(body, user?.username), options: profileOptions() };
  }
}
