import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { OrmModule } from '../../orm/orm.module.js';
import { UserEntity } from '../../entities/user.entity.js';
import { SessionEntity } from '../../entities/session.entity.js';

@Module({
  imports: [OrmModule.forFeature([UserEntity, SessionEntity])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
