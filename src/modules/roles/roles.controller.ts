import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Permission(['roles', 'view'], ['users', 'view'], ['users', 'create'], ['users', 'edit'])
  @Get('resources')
  async getResources() {
    return this.rolesService.getResourcesAndRights();
  }

  @Permission(['roles', 'view'], ['users', 'view'], ['users', 'create'], ['users', 'edit'])
  @Get()
  async listRoles() {
    return this.rolesService.listRoles();
  }

  @Permission(['roles', 'view'], ['users', 'view'], ['users', 'create'], ['users', 'edit'])
  @Get(':id')
  async getRole(@Param('id') id: string) {
    return this.rolesService.getRole(+id);
  }

  @Roles('admin')
  @Permission(['roles', 'create'])
  @Post()
  async createRole(@Body() body: any) {
    return this.rolesService.createRole(body);
  }

  @Roles('admin')
  @Permission(['roles', 'edit'])
  @Put(':id')
  async updateRole(@Param('id') id: string, @Body() body: any) {
    return this.rolesService.updateRole(+id, body);
  }

  @Roles('admin')
  @Permission(['roles', 'delete'])
  @Delete(':id')
  async deleteRole(@Param('id') id: string) {
    return this.rolesService.deleteRole(+id);
  }
}
