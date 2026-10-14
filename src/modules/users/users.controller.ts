import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { Permission } from '../../common/decorators/permission.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Permission(['users', 'view'])
  @Get()
  async listUsers() {
    return this.usersService.listUsers();
  }

  @Permission(['users', 'create'])
  @Post()
  async createUser(@CurrentUser() user: any, @Body() body: any) {
    return this.usersService.createUser(user, body);
  }

  @Permission(['users', 'edit'])
  @Put(':id')
  async updateUser(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.usersService.updateUser(user, +id, body);
  }

  @Permission(['users', 'delete'])
  @Delete(':id')
  async deleteUser(@CurrentUser() user: any, @Param('id') id: string) {
    return this.usersService.deleteUser(user, +id);
  }
}
