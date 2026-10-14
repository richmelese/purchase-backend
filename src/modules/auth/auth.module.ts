import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { UserEntity } from '../../entities/user.entity.js';
import { SessionEntity } from '../../entities/session.entity.js';
import { SettingEntity } from '../../entities/setting.entity.js';

@Module({
  imports: [OrmModule.forFeature([UserEntity, SessionEntity, SettingEntity])],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
