import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode } from '@nestjs/common';
import { PartiesService } from './parties.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { assertParty } from '../../common/permissions.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

@Controller('parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @Permission(['parties', 'view'], ['purchases', 'view'], ['purchases', 'create'], ['purchases', 'edit'], ['sales', 'view'], ['sales', 'create'], ['sales', 'edit'])
  @Get()
  async listParties(@Query('type') type?: string, @Query('q') q?: string, @CurrentUser() user?: any) {
    return this.partiesService.listParties(type, q, user);
  }

  @Permission(['parties', 'view'], ['purchases', 'view'], ['purchases', 'create'], ['purchases', 'edit'], ['sales', 'view'], ['sales', 'create'], ['sales', 'edit'])
  @Get('by-tin/:tin')
  async getByTin(@Param('tin') tin: string, @CurrentUser() user: any) {
    const party: any = await this.partiesService.getByTin(tin);
    assertParty(user, party.id);
    return party;
  }

  @Permission(['parties', 'create'], ['parties', 'edit'])
  @Get('profile-template')
  profileTemplate() {
    return this.partiesService.profileTemplate();
  }

  @Permission(['parties', 'view'], ['parties', 'edit'])
  @Get(':id')
  async getParty(@Param('id') id: string, @CurrentUser() user: any) {
    assertParty(user, +id);
    return this.partiesService.getParty(+id);
  }

  @Permission(['parties', 'view'])
  @Get(':id/statement')
  async getStatement(@Param('id') id: string, @CurrentUser() user: any) {
    assertParty(user, +id);
    return this.partiesService.getStatement(+id);
  }

  @Permission(['parties', 'create'])
  @Post()
  async create(@Body() body: any, @CurrentUser() user: any) {
    return this.partiesService.create(body, user);
  }

  /** Create the company's login, or reset its password. Administrators only. */
  @Permission(['users', 'create'], ['users', 'edit'])
  @Post(':id/account')
  issueLogin(@Param('id') id: string, @CurrentUser() user: any) {
    assertParty(user, +id, 'edit');
    return this.partiesService.issueLogin(+id);
  }

  @Permission(['parties', 'edit'])
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    assertParty(user, +id, 'edit');
    return this.partiesService.update(+id, body);
  }

  @Permission(['parties', 'delete'])
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    assertParty(user, +id, 'delete');
    await this.partiesService.delete(+id);
  }
}
