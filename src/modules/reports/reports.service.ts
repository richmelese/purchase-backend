import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from '../../orm/data-source.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { ProductsService } from '../products/products.service.js';
import { VatService } from '../vat/vat.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WithholdingService } from '../withholding/withholding.service.js';
import { CreditService } from '../credit/credit.service.js';
import { FY_MONTHS, currentFiscalYear } from '../../common/lib/ethiopian.js';
import { round2 } from '../../common/lib/calc.js';

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly invoicesService: InvoicesService,
    private readonly productsService: ProductsService,
    private readonly vatService: VatService,
    private readonly settingsService: SettingsService,
    private readonly withholdingService: WithholdingService,
    private readonly creditService: CreditService,
  ) {}

  public async dashboard(fy: number) {
    fy = +fy;
    const monthly = this.dataSource.query<any>(
      `SELECT kind, fy_month, SUM(taxable_amount) AS amount, SUM(vat_amount) AS vat, COUNT(*) AS n
       FROM invoices WHERE fy = ? GROUP BY kind, fy_month`,
      [fy],
    );
    const series = { P: Array(12).fill(0), S: Array(12).fill(0) };
    const totals = { P: { amount: 0, vat: 0, n: 0 }, S: { amount: 0, vat: 0, n: 0 } };
    for (const r of monthly) {
      (series as any)[r.kind][r.fy_month] = round2(r.amount);
      (totals as any)[r.kind].amount += r.amount;
      (totals as any)[r.kind].vat += r.vat;
      (totals as any)[r.kind].n += r.n;
    }

    const vat = await this.vatService.vatDeclaration(fy);
    const line = (no: number) => vat.lines.find((l) => l.no === no);
    const allStock = await this.productsService.stockReport();
    const stock = allStock.filter((s) => s.track_stock);

    const payables = await this.creditService.creditReport({ kind: 'P' });
    const receivables = await this.creditService.creditReport({ kind: 'S' });
    const whAll = await this.withholdingService.withholdingReport({ kind: 'P', fy });
    const whPending = whAll.filter((w: any) => w.wh.outstanding > 0.004);

    const unreported = this.dataSource.query<{ kind: string; n: number }>(
      "SELECT kind, COUNT(*) AS n FROM invoices WHERE fy = ? AND report_status = 'Not Reported' GROUP BY kind",
      [fy],
    );
    const topSuppliers = this.dataSource.query(
      `SELECT COALESCE(party_name, 'Unregistered') AS name, SUM(taxable_amount) AS amount, COUNT(*) AS n
       FROM invoices WHERE fy = ? AND kind = 'P' GROUP BY COALESCE(party_tin, party_name) ORDER BY amount DESC LIMIT 5`,
      [fy],
    );
    const topCustomers = this.dataSource.query(
      `SELECT COALESCE(party_name, 'Unregistered') AS name, SUM(taxable_amount) AS amount, COUNT(*) AS n
       FROM invoices WHERE fy = ? AND kind = 'S' GROUP BY COALESCE(party_tin, party_name) ORDER BY amount DESC LIMIT 5`,
      [fy],
    );
    const recent = this.dataSource.query(
      `SELECT id, kind, invoice_no, date, party_name, grand_total, payment_type FROM invoices
       ORDER BY created_at DESC, id DESC LIMIT 8`,
    );

    const rules = await this.settingsService.getRules();

    return {
      fy,
      months: FY_MONTHS,
      series,
      totals: {
        sales: round2(totals.S.amount),
        salesVat: round2(totals.S.vat),
        salesCount: totals.S.n,
        purchases: round2(totals.P.amount),
        purchaseVat: round2(totals.P.vat),
        purchaseCount: totals.P.n,
        vatPayable: line(200)?.values.reduce((a: number, b: number) => a + b, 0) || 0,
        creditCarried: line(205)?.values[11] || 0,
      },
      vatByMonth: line(200)?.values || [],
      stock: {
        items: stock.length,
        value: round2(stock.reduce((a, s) => a + s.stock_value, 0)),
        low: stock
          .filter(
            (s) =>
              (s.status === 'Low stock' || s.status === 'Out of stock') &&
              (s.min_stock > 0 || s.stock_in > 0 || s.opening_stock > 0),
          )
          .map((s) => ({ code: s.code, name: s.name_en, current: s.current_stock, min: s.min_stock, status: s.status })),
      },
      payables: { count: payables.length, amount: round2(payables.reduce((a, i) => a + i.balance, 0)) },
      receivables: { count: receivables.length, amount: round2(receivables.reduce((a, i) => a + i.balance, 0)) },
      whPending: { count: whPending.length, amount: round2(whPending.reduce((a: any, w: any) => a + w.wh.outstanding, 0)) },
      unreported: Object.fromEntries(unreported.map((u) => [u.kind, u.n])),
      topSuppliers,
      topCustomers,
      recent,
      rules,
    };
  }

  public async monthlySummary(fy: number) {
    const rows = FY_MONTHS.map((month, idx) => ({
      idx,
      month,
      sales: 0,
      output_vat: 0,
      sales_count: 0,
      purchases: 0,
      input_vat: 0,
      purchase_count: 0,
      wh_on_purchases: 0,
      wh_on_sales: 0,
      net_vat: 0,
    }));

    for (const kind of ['S', 'P'] as const) {
      const invoices = await this.invoicesService.listInvoices({ kind, fy });
      for (const i of invoices) {
        const r = rows[i.fy_month];
        if (kind === 'S') {
          r.sales += i.taxable_amount;
          r.output_vat += i.vat_amount;
          r.sales_count += 1;
          r.wh_on_sales += i.wh.expected;
        } else {
          r.purchases += i.taxable_amount;
          r.input_vat += i.vat_amount;
          r.purchase_count += 1;
          r.wh_on_purchases += i.wh.expected;
        }
      }
    }

    for (const r of rows) {
      r.net_vat = r.output_vat - r.input_vat;
      for (const k of Object.keys(r)) {
        if (typeof (r as any)[k] === 'number' && k !== 'idx') {
          (r as any)[k] = round2((r as any)[k]);
        }
      }
    }

    const total = rows.reduce(
      (t: any, r: any) => {
        for (const k of Object.keys(r)) {
          if (typeof r[k] === 'number' && k !== 'idx') {
            t[k] = round2((t[k] || 0) + r[k]);
          }
        }
        return t;
      },
      { month: 'Total' },
    );

    return { fy: +fy, rows, total };
  }

  public async salesByProduct(period: { fy?: number; month?: number | string } = {}) {
    const w: string[] = [];
    const p: any[] = [];
    if (period.fy) {
      w.push('i.fy = ?');
      p.push(+period.fy);
    }
    if (period.month !== undefined && period.month !== '' && period.month !== null) {
      w.push('i.fy_month = ?');
      p.push(+period.month);
    }
    const whereSql = w.length ? ` AND ${w.join(' AND ')}` : '';

    const sql = `SELECT COALESCE(pr.code, l.product_code, '') AS code, COALESCE(pr.name_en, l.description) AS name, pr.id AS product_id,
        SUM(l.qty) AS qty, SUM(l.total) AS sales, SUM(l.vat_amount) AS vat, COUNT(DISTINCT i.id) AS invoices,
        (SELECT SUM(pl.total) / NULLIF(SUM(pl.qty), 0) FROM invoice_lines pl JOIN invoices pi ON pi.id = pl.invoice_id
          WHERE pi.kind = 'P' AND pl.product_id = pr.id) AS avg_cost,
        pr.purchase_price
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id LEFT JOIN products pr ON pr.id = l.product_id
      WHERE i.kind = 'S'${whereSql}
      GROUP BY COALESCE(pr.id, l.description) ORDER BY sales DESC`;

    const rows = this.dataSource.query<any>(sql, p);
    return rows.map((r) => {
      const unitCost = r.avg_cost ?? (r.purchase_price || null);
      const cost = unitCost != null ? round2(unitCost * r.qty) : null;
      const profit = cost != null ? round2(r.sales - cost) : null;
      return {
        code: r.code,
        name: r.name,
        qty: r.qty,
        invoices: r.invoices,
        sales: round2(r.sales),
        vat: round2(r.vat),
        unit_cost: unitCost != null ? round2(unitCost) : null,
        cost,
        profit,
        margin: profit != null && r.sales ? round2((profit / r.sales) * 100) : null,
      };
    });
  }

  public async partyTotals(kind: 'P' | 'S', period: any = {}) {
    if (!['P', 'S'].includes(kind)) throw new NotFoundException('Unknown resource');
    const invoices = await this.invoicesService.listInvoices({ kind, ...period });
    const map = new Map<string, any>();

    for (const i of invoices) {
      const key = i.party_id ? `id:${i.party_id}` : `name:${i.party_tin || i.party_name || '—'}`;
      const r = map.get(key) || {
        party_id: i.party_id,
        name: i.party_name || 'Unregistered',
        tin: i.party_tin,
        count: 0,
        taxable: 0,
        vat: 0,
        total: 0,
        wh: 0,
        balance: 0,
      };
      r.count += 1;
      r.taxable += i.taxable_amount;
      r.vat += i.vat_amount;
      r.total += i.grand_total;
      r.wh += i.wh.expected;
      r.balance += i.balance;
      map.set(key, r);
    }

    return [...map.values()]
      .map((r) => ({
        ...r,
        taxable: round2(r.taxable),
        vat: round2(r.vat),
        total: round2(r.total),
        wh: round2(r.wh),
        balance: round2(r.balance),
      }))
      .sort((a, b) => b.total - a.total);
  }
}
