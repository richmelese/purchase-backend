import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { InvoiceLineEntity } from '../../entities/invoice-line.entity.js';
import { PaymentEntity } from '../../entities/payment.entity.js';
import { PartyEntity } from '../../entities/party.entity.js';
import { ProductEntity } from '../../entities/product.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { LookupsService } from '../lookups/lookups.service.js';
import {
  computeLine,
  computeTotals,
  computeWithholding,
  typesFor,
  round2,
  receiptNumberError,
  TRANSACTION_TYPES,
  REPORT_STATUSES,
} from '../../common/lib/calc.js';
import { taxPeriod } from '../../common/lib/ethiopian.js';

const str = (v: any) => (v == null ? '' : String(v).trim());
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(InvoiceEntity) private readonly invoiceRepo: Repository<InvoiceEntity>,
    @InjectRepository(InvoiceLineEntity) private readonly lineRepo: Repository<InvoiceLineEntity>,
    @InjectRepository(PaymentEntity) private readonly paymentRepo: Repository<PaymentEntity>,
    @InjectRepository(PartyEntity) private readonly partyRepo: Repository<PartyEntity>,
    @InjectRepository(ProductEntity) private readonly productRepo: Repository<ProductEntity>,
    private readonly settingsService: SettingsService,
    private readonly lookupsService: LookupsService,
  ) {}

  public nextNumber(kind: 'P' | 'S'): string {
    const ds = this.invoiceRepo.getDataSource();
    const row = ds.queryOne<{ n: number }>(
      `SELECT MAX(CAST(SUBSTR(invoice_no, 2) AS INTEGER)) AS n FROM invoices
       WHERE kind = ? AND invoice_no GLOB ?`,
      [kind, `${kind}[0-9]*`],
    );
    return `${kind}${String((row?.n || 0) + 1).padStart(4, '0')}`;
  }

  private async validate(kind: 'P' | 'S', input: any) {
    const errors: Record<string, any> = {};
    const h = {
      invoice_no: str(input.invoice_no),
      payment_type: str(input.payment_type),
      vat_category: str(input.vat_category),
      calendar_type: str(input.calendar_type) || 'G',
      party_tin: str(input.party_tin),
      party_name: str(input.party_name),
      date: str(input.date),
      receipt_type: str(input.receipt_type),
      mrc_number: str(input.mrc_number),
      vat_receipt_no: str(input.vat_receipt_no).toUpperCase(),
      report_status: str(input.report_status) || 'Not Reported',
      notes: str(input.notes),
    };

    const paymentTypes = await this.lookupsService.lookupValues('payment_type');
    if (!paymentTypes.includes(h.payment_type)) errors.payment_type = 'Select Cash or Credit';
    if (!['G', 'S'].includes(h.vat_category)) errors.vat_category = 'Select Goods or Service';
    if (!['E', 'G'].includes(h.calendar_type)) errors.calendar_type = 'Select a calendar type';
    if (!isIsoDate(h.date)) errors.date = 'A valid date is required';

    const receiptTypes = await this.lookupsService.lookupValues('receipt_type');
    if (!receiptTypes.includes(h.receipt_type)) errors.receipt_type = 'Select a receipt type';
    if (h.receipt_type === 'MRC' && !h.mrc_number) errors.mrc_number = 'MRC number is required for MRC receipts';
    if (!h.vat_receipt_no) errors.vat_receipt_no = 'Receipt number is required';
    else if (receiptNumberError(h.receipt_type, h.vat_receipt_no)) {
      errors.vat_receipt_no = receiptNumberError(h.receipt_type, h.vat_receipt_no);
    }
    if (!REPORT_STATUSES.includes(h.report_status)) errors.report_status = 'Invalid report status';
    if (h.party_tin && !/^\d{1,15}$/.test(h.party_tin)) errors.party_tin = 'TIN must contain digits only';
    if (h.payment_type === 'Credit' && !h.party_tin && !h.party_name) {
      errors.party_name = `A ${kind === 'P' ? 'supplier' : 'customer'} is required for credit transactions`;
    }

    const types = typesFor(kind).map((t) => t.value);
    const units = (await this.lookupsService.lookupValues('unit')).map(Number);
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) errors.lines = 'Add at least one line item';
    const lineErrors = lines.map((l: any) => {
      const e: Record<string, string> = {};
      if (!str(l.description)) e.description = 'Required';
      if (!types.includes(+l.tx_type)) e.tx_type = 'Required';
      if (!TRANSACTION_TYPES.includes(l.transaction_type)) e.transaction_type = 'Required';
      if (!units.includes(+l.unit)) e.unit = 'Required';
      if (!(Number(l.qty) > 0)) e.qty = 'Must be > 0';
      if (!(Number(l.unit_price) >= 0) || l.unit_price === '' || l.unit_price == null) e.unit_price = 'Required';
      if (Number(l.excise_rate) < 0 || Number(l.excise_rate) > 500) e.excise_rate = '0–500 %';
      return e;
    });
    if (lineErrors.some((e: any) => Object.keys(e).length)) errors.line_items = lineErrors;

    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });
    return { h, lines };
  }

  private async resolveParty(kind: 'P' | 'S', h: any) {
    if (!h.party_tin) return { id: null, name: h.party_name };
    const p = await this.partyRepo.findOne({ where: { tin: h.party_tin } });
    if (p) {
      const wanted = kind === 'P' ? 'Supplier' : 'Customer';
      if (p.type !== wanted && p.type !== 'Both') {
        await this.partyRepo.update(p.id, { type: 'Both' });
      }
      return { id: p.id, name: p.name };
    }
    if (!h.party_name) {
      throw new BadRequestException({ message: 'Unknown TIN – enter the name to register it', fields: { party_name: 'Required for a new TIN' } });
    }
    const { insertId } = await this.partyRepo.insert({
      tin: h.party_tin,
      name: h.party_name,
      type: kind === 'P' ? 'Supplier' : 'Customer',
    });
    return { id: insertId, name: h.party_name };
  }

  public async decorate(inv: any) {
    const rules = await this.settingsService.getRules();
    const wh = computeWithholding(inv, rules);
    const paidRow = this.invoiceRepo.getDataSource().queryOne<{ s: number }>(
      'SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?',
      [inv.id],
    );
    const due = round2(inv.grand_total - wh.expected);
    const paid = inv.payment_type === 'Cash' ? due : round2(paidRow?.s || 0);
    return { ...inv, wh, amount_due: due, amount_paid: paid, balance: round2(due - paid) };
  }

  public async getInvoice(id: number) {
    const inv = await this.invoiceRepo.findById(id);
    if (!inv) throw new NotFoundException('Not found');
    const out = await this.decorate(inv);
    out.lines = await this.lineRepo.find({ where: { invoice_id: id }, order: { line_no: 'ASC' } });
    out.payments = await this.paymentRepo.find({ where: { invoice_id: id }, order: { date: 'ASC', id: 'ASC' } });
    return out;
  }

  public async saveInvoice(kind: 'P' | 'S', input: any, id: number | null = null, username?: string) {
    const { h, lines } = await this.validate(kind, input);
    const rules = await this.settingsService.getRules();
    const computed = lines.map((l: any) => computeLine(l, rules));
    const totals = computeTotals(computed);
    const period = taxPeriod(h.date);

    const ds = this.invoiceRepo.getDataSource();
    return ds.transactionAsync(async () => {
      const invoice_no = h.invoice_no || (id ? null : this.nextNumber(kind));
      if (invoice_no) {
        const dupNo = ds.queryOne('SELECT id FROM invoices WHERE invoice_no = ? AND id IS NOT ?', [invoice_no, id]);
        if (dupNo) throw new ConflictException({ message: `Number ${invoice_no} is already used`, fields: { invoice_no: 'Already used' } });
      }

      const party = await this.resolveParty(kind, h);
      if (h.party_tin) {
        const dup = ds.queryOne<{ invoice_no: string }>(
          'SELECT invoice_no FROM invoices WHERE kind = ? AND party_tin = ? AND vat_receipt_no = ? AND id IS NOT ?',
          [kind, h.party_tin, h.vat_receipt_no, id],
        );
        if (dup) {
          throw new ConflictException({
            message: `Receipt ${h.vat_receipt_no} for this TIN is already recorded as ${dup.invoice_no}`,
            fields: { vat_receipt_no: 'Duplicate receipt' },
          });
        }
      }

      const values: any = {
        payment_type: h.payment_type,
        vat_category: h.vat_category,
        calendar_type: h.calendar_type,
        party_id: party.id,
        party_tin: h.party_tin || null,
        party_name: party.name || null,
        date: h.date,
        fy: period?.fy,
        fy_month: period?.idx,
        receipt_type: h.receipt_type,
        mrc_number: h.mrc_number || null,
        vat_receipt_no: h.vat_receipt_no,
        report_status: h.report_status,
        notes: h.notes || null,
        ...totals,
      };

      let invoiceId = id;
      if (id) {
        const exists = ds.queryOne('SELECT id FROM invoices WHERE id = ? AND kind = ?', [id, kind]);
        if (!exists) throw new NotFoundException('Not found');
        const sets = Object.keys(values).map((k) => `${k} = ?`).join(', ');
        ds.execute(
          `UPDATE invoices SET ${sets}, ${invoice_no ? 'invoice_no = ?,' : ''} updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
          [...Object.values(values), ...(invoice_no ? [invoice_no] : []), username || null, id],
        );
        ds.execute('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]);
      } else {
        const cols = ['kind', 'invoice_no', ...Object.keys(values), 'created_by', 'updated_by'];
        const r = ds.execute(
          `INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          [kind, invoice_no, ...Object.values(values), username || null, username || null],
        );
        invoiceId = Number(r.lastInsertRowid);
      }

      for (let i = 0; i < computed.length; i++) {
        const l = computed[i];
        const code = str(l.product_code);
        const product = code ? ds.queryOne<{ id: number }>('SELECT id FROM products WHERE code = ?', [code]) : null;
        ds.execute(
          `INSERT INTO invoice_lines
          (invoice_id, line_no, product_id, product_code, description, unit, tx_type, transaction_type, qty, unit_price,
           total, excise_rate, excise_amount, vatable_service_fee, taxable_amount, vat_amount, non_vatable_fee, line_total)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            invoiceId,
            i + 1,
            product ? product.id : null,
            code || null,
            str(l.description),
            l.unit ? +l.unit : null,
            +l.tx_type,
            l.transaction_type,
            l.qty,
            l.unit_price,
            l.total,
            l.excise_rate,
            l.excise_amount,
            l.vatable_service_fee,
            l.taxable_amount,
            l.vat_amount,
            l.non_vatable_fee,
            l.line_total,
          ],
        );
      }

      return this.getInvoice(invoiceId!);
    });
  }

  public async listInvoices({ kind, fy, month, q, status, payment }: any, user?: any) {
    const where: string[] = ['kind = :kind'];
    const p: any = { kind };
    if (fy) {
      where.push('fy = :fy');
      p.fy = +fy;
    }
    if (month !== undefined && month !== '' && month !== null) {
      where.push('fy_month = :month');
      p.month = +month;
    }
    if (status) {
      where.push('report_status = :status');
      p.status = status;
    }
    if (payment) {
      where.push('payment_type = :payment');
      p.payment = payment;
    }
    if (q) {
      where.push(`(invoice_no LIKE :q OR party_name LIKE :q OR party_tin LIKE :q OR vat_receipt_no LIKE :q
        OR id IN (SELECT invoice_id FROM invoice_lines WHERE description LIKE :q OR product_code LIKE :q))`);
      p.q = `%${q}%`;
    }
    if (user && !user.access_all_parties && Array.isArray(user.assigned_party_ids)) {
      if (user.assigned_party_ids.length === 0) {
        where.push('1 = 0');
      } else {
        const placeholders = user.assigned_party_ids.map((_: number, i: number) => `:inv_pid_${i}`).join(',');
        where.push(`party_id IN (${placeholders})`);
        user.assigned_party_ids.forEach((id: number, i: number) => {
          p[`inv_pid_${i}`] = id;
        });
      }
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM invoices ${whereClause} ORDER BY date DESC, id DESC`;
    const rows = this.invoiceRepo.getDataSource().query(sql, p);
    return Promise.all(rows.map((r) => this.decorate(r)));
  }

  public async deleteInvoice(id: number) {
    const res = await this.invoiceRepo.delete(id);
    if (!res.affected) throw new NotFoundException('Not found');
  }

  public async updateWithholding(id: number, input: any) {
    const type = str(input.wh_receipt_type);
    if (type) {
      const allowed = await this.lookupsService.lookupValues('wh_receipt_type');
      if (!allowed.includes(type)) throw new BadRequestException('Invalid WH receipt type');
    }
    const date = str(input.wh_receipt_date);
    if (date && !isIsoDate(date)) {
      throw new BadRequestException({ message: 'Invalid WH receipt date', fields: { wh_receipt_date: 'Invalid date' } });
    }
    const paid = Number(input.wh_paid) || 0;
    if (paid < 0) throw new BadRequestException({ message: 'WH paid cannot be negative', fields: { wh_paid: 'Must be ≥ 0' } });

    const res = await this.invoiceRepo.update(id, {
      wh_receipt_type: type || null,
      wh_receipt_no: str(input.wh_receipt_no) || null,
      wh_receipt_date: date || null,
      wh_paid: paid,
    } as any);

    if (!res.affected) throw new NotFoundException('Not found');
    return this.getInvoice(id);
  }

  public async setReportStatus(ids: number[], status: string) {
    if (!REPORT_STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    const ds = this.invoiceRepo.getDataSource();
    ds.transaction(() => {
      ids.forEach((id) => ds.execute("UPDATE invoices SET report_status = ?, updated_at = datetime('now') WHERE id = ?", [status, +id]));
    });
    return { ok: true };
  }

  public async addPayment(invoiceId: number, input: any) {
    const inv = await this.getInvoice(invoiceId);
    if (inv.payment_type !== 'Credit') throw new BadRequestException('Payments are tracked only for credit transactions');
    const amount = round2(input.amount);
    if (!(amount > 0)) throw new BadRequestException({ message: 'Amount must be greater than 0', fields: { amount: 'Must be > 0' } });
    if (amount > inv.balance + 0.005) {
      throw new BadRequestException({ message: `Amount exceeds the outstanding balance (${inv.balance.toFixed(2)})`, fields: { amount: 'Too large' } });
    }
    const date = str(input.date);
    if (!isIsoDate(date)) throw new BadRequestException({ message: 'A valid date is required', fields: { date: 'Required' } });

    await this.paymentRepo.insert({
      invoice_id: invoiceId,
      date,
      amount,
      method: str(input.method) || null,
      reference: str(input.reference) || null,
      notes: str(input.notes) || null,
    });

    return this.getInvoice(invoiceId);
  }

  public async deletePayment(id: number) {
    const p = await this.paymentRepo.findById(id);
    if (!p) throw new NotFoundException('Not found');
    await this.paymentRepo.delete(id);
    return this.getInvoice(p.invoice_id);
  }
}
