import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { CompanyAccess } from '../../common/decorators/account-scope.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { PartiesService } from '../parties/parties.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AnyStaff } from '../../common/decorators/permission.decorator.js';

// Company (portal) accounts: read-only view of their own company. Every query is filtered by the
// signed-in account's company; nothing here takes a company id from the request.
@AnyStaff()
@CompanyAccess()
@Controller('portal')
export class PortalController {
  constructor(
    private readonly parties: PartiesService,
    private readonly invoices: InvoicesService,
    private readonly settings: SettingsService,
  ) {}

  private companyOf(user: any): number {
    if (!user?.party_id) throw new ForbiddenException('Only company accounts can use the company portal');
    return user.party_id;
  }

  @Get('company')
  async company(@CurrentUser() user: any) {
    const { options, ...company } = await this.parties.getParty(this.companyOf(user));
    const s = await this.settings.getSettings();
    return {
      company,
      options,
      account: { username: user.username },
      // The business the company trades with (letterhead on printed documents).
      issuer: { company_name: s.company_name, company_tin: s.company_tin, company_address: s.company_address, wh_rate: s.wh_rate },
    };
  }

  @Get('statement')
  statement(@CurrentUser() user: any) {
    return this.parties.getStatement(this.companyOf(user));
  }

  @Get('invoices')
  listInvoices(@CurrentUser() user: any, @Query('kind') kind?: string, @Query('fy') fy?: string) {
    const party = this.companyOf(user);
    const k = kind === 'S' ? 'S' : 'P';
    return this.invoices.listInvoices({ kind: k, fy }, { access_all_parties: false, assigned_party_ids: [party] });
  }

  @Get('invoices/:id')
  async invoice(@CurrentUser() user: any, @Param('id') id: string) {
    const party = this.companyOf(user);
    let inv: any;
    try { inv = await this.invoices.getInvoice(+id); } catch { inv = null; }
    if (!inv || inv.party_id !== party) throw new NotFoundException('Not found');
    return inv;
  }
}
