import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, NotFoundException, BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { CheckedInHandler } from '../../common/decorators/permission.decorator.js';
import { DataSource } from '../../orm/data-source.js';
import { allowedParties, assertCan, assertParty, Grant, Right } from '../../common/permissions.js';

// Purchases and sales share every endpoint; only the invoice kind (and so the permission resource) differs.
// (Express 5 / path-to-regexp v8 no longer supports `:kind(purchases|sales)` route params.)
abstract class InvoiceKindController {
  protected abstract readonly kind: 'P' | 'S';

  constructor(
    protected readonly invoicesService: InvoicesService,
    protected readonly ds: DataSource,
  ) {}

  protected get resource() {
    return this.kind === 'P' ? 'purchases' : 'sales';
  }

  protected need(user: any, right: Right, ...alternatives: Grant[]) {
    assertCan(user, [this.resource, right], ...alternatives);
  }

  /** Changing an invoice (not recording a payment on it): purchases have a separate task for each. */
  protected needUpdate(user: any, ...alternatives: Grant[]) {
    assertCan(user, this.kind === 'P' ? ['purchases', 'edit', 'update_purchase'] : ['sales', 'edit'], ...alternatives);
  }

  /** The invoice, if it is of this kind and its company is within the user's access. */
  protected async load(user: any, id: string, right: Right = 'view') {
    let inv: any;
    try { inv = await this.invoicesService.getInvoice(+id); } catch { inv = null; }
    if (!inv || inv.kind !== this.kind) throw new NotFoundException('Not found');
    assertParty(user, inv.party_id, right);
    return inv;
  }

  /** Users restricted to some companies may only record invoices for those companies. */
  protected assertBodyParty(user: any, body: any, right: Right) {
    const allowed = allowedParties(user, right);
    if (allowed === null) return;
    const tin = String(body?.party_tin ?? '').trim();
    const party = tin ? this.ds.queryOne<{ id: number }>('SELECT id FROM parties WHERE tin = ?', [tin]) : null;
    if (!party || !allowed.includes(party.id)) {
      throw new BadRequestException({
        message: `You can only ${right === 'create' ? 'record' : 'change'} invoices for companies where your access allows it`,
        fields: { party_tin: 'Choose one of your companies' },
      });
    }
  }

  @CheckedInHandler()
  @Get('next-number')
  async getNextNumber(@CurrentUser() user: any) {
    this.need(user, 'create');
    return { number: this.invoicesService.nextNumber(this.kind) };
  }

  @CheckedInHandler()
  @Get()
  async listInvoices(@Query() query: any, @CurrentUser() user: any) {
    this.need(user, 'view');
    return this.invoicesService.listInvoices({ ...query, kind: this.kind }, user);
  }

  @CheckedInHandler()
  @Post()
  async createInvoice(@Body() body: any, @CurrentUser() user: any) {
    this.need(user, 'create');
    this.assertBodyParty(user, body, 'create');
    return this.invoicesService.saveInvoice(this.kind, body, null, user?.username);
  }

  @CheckedInHandler()
  @Post('report-status')
  async setReportStatus(@Body() body: any, @CurrentUser() user: any) {
    this.needUpdate(user);
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    for (const id of ids) await this.load(user, String(id), 'edit');
    return this.invoicesService.setReportStatus(ids, body.status);
  }

  @CheckedInHandler()
  @Get(':id')
  async getInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    this.need(user, 'view');
    return this.load(user, id);
  }

  @CheckedInHandler()
  @Put(':id')
  async updateInvoice(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    this.needUpdate(user);
    await this.load(user, id, 'edit');
    this.assertBodyParty(user, body, 'edit');
    return this.invoicesService.saveInvoice(this.kind, body, +id, user?.username);
  }

  @CheckedInHandler()
  @Delete(':id')
  @HttpCode(204)
  async deleteInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    this.need(user, 'delete');
    await this.load(user, id, 'delete');
    await this.invoicesService.deleteInvoice(+id);
  }

  @CheckedInHandler()
  @Put(':id/withholding')
  async updateWithholding(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    this.needUpdate(user, ['withholding', 'edit']);
    await this.load(user, id, 'edit');
    return this.invoicesService.updateWithholding(+id, body);
  }

  @CheckedInHandler()
  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    // Purchases: the role's "Record credit payment" task; sales: the edit right. Credit rights also allow it.
    assertCan(user, this.kind === 'P' ? ['purchases', 'edit', 'record_payment_p'] : ['sales', 'edit'], ['credit', 'create'], ['credit', 'edit']);
    await this.load(user, id, 'edit');
    return this.invoicesService.addPayment(+id, body);
  }
}

@Controller('purchases')
export class PurchasesController extends InvoiceKindController {
  protected readonly kind = 'P' as const;

  constructor(invoicesService: InvoicesService, ds: DataSource) {
    super(invoicesService, ds);
  }
}

@Controller('sales')
export class SalesController extends InvoiceKindController {
  protected readonly kind = 'S' as const;

  constructor(invoicesService: InvoicesService, ds: DataSource) {
    super(invoicesService, ds);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly ds: DataSource,
  ) {}

  @CheckedInHandler()
  @Delete(':id')
  async deletePayment(@Param('id') id: string, @CurrentUser() user: any) {
    const row = this.ds.queryOne<{ kind: 'P' | 'S'; party_id: number | null }>(
      'SELECT i.kind, i.party_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?',
      [+id],
    );
    if (!row) throw new NotFoundException('Not found');
    assertCan(user, row.kind === 'P' ? ['purchases', 'edit', 'record_payment_p'] : ['sales', 'edit'], ['credit', 'delete']);
    assertParty(user, row.party_id, 'edit');
    return this.invoicesService.deletePayment(+id);
  }
}
