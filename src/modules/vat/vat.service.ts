import { Injectable, BadRequestException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { VatAdjustmentEntity } from '../../entities/vat-adjustment.entity.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { FY_MONTHS, currentFiscalYear } from '../../common/lib/ethiopian.js';
import { round2 } from '../../common/lib/calc.js';

export const VAT_LINES = [
  { no: 5, label: 'Taxable sales / supplies', kind: 'auto' },
  { no: 10, label: 'VAT on taxable sales / supplies', kind: 'auto' },
  { no: 15, label: 'Zero-rated sales / supplies', kind: 'auto' },
  { no: 20, label: 'Tax-exempt sales / supplies', kind: 'auto' },
  { no: 25, label: 'Services or supplies subject to reverse taxation', kind: 'manual' },
  { no: 30, label: 'VAT on services or supplies subject to reverse taxation', kind: 'manual' },
  { no: 35, label: 'Tax adjustment with debit note', kind: 'manual' },
  { no: 40, label: 'VAT on tax adjustment with debit note', kind: 'manual' },
  { no: 45, label: 'Tax adjustment with credit note', kind: 'manual' },
  { no: 50, label: 'VAT on tax adjustment with credit note', kind: 'manual' },
  { no: 55, label: 'Total sales / supplies (5+15+20+25+35−45)', kind: 'calc', total: true },
  { no: 60, label: 'VAT on total sales / supplies (10+30+40−50)', kind: 'calc', total: true },
  { no: 65, label: 'Local purchase – capital assets', kind: 'auto' },
  { no: 70, label: 'VAT on local purchase – capital assets', kind: 'auto' },
  { no: 75, label: 'Imported capital assets', kind: 'auto' },
  { no: 80, label: 'VAT on imported capital assets', kind: 'auto' },
  { no: 85, label: 'Purchase with no VAT or unclaimed inputs (capital)', kind: 'auto' },
  { no: 90, label: 'Total capital assets (65+75+85)', kind: 'calc', total: true },
  { no: 95, label: 'VAT on total capital assets (70+80)', kind: 'calc', total: true },
  { no: 100, label: 'Local purchase – inputs', kind: 'auto' },
  { no: 105, label: 'VAT on local purchase – inputs', kind: 'auto' },
  { no: 110, label: 'Imported inputs', kind: 'auto' },
  { no: 115, label: 'VAT on imported inputs', kind: 'auto' },
  { no: 120, label: 'General expense inputs purchase', kind: 'auto' },
  { no: 125, label: 'VAT on general expense inputs', kind: 'auto' },
  { no: 130, label: 'Purchases with no VAT or unclaimed inputs', kind: 'auto' },
  { no: 135, label: 'Deductible on VAT reverse taxation', kind: 'manual' },
  { no: 140, label: 'VAT on deductible reverse taxation', kind: 'manual' },
  { no: 145, label: 'Tax adjustments with debit note', kind: 'manual' },
  { no: 150, label: 'VAT on tax adjustments with debit note', kind: 'manual' },
  { no: 155, label: 'Tax adjustments with credit note', kind: 'manual' },
  { no: 160, label: 'VAT on tax adjustments with credit note', kind: 'manual' },
  { no: 165, label: 'Total non-capital inputs (100+110+120+130+135+145−155)', kind: 'calc', total: true },
  { no: 170, label: 'VAT on total inputs (105+115+125+140+150−160)', kind: 'calc', total: true },
  { no: 175, label: 'VAT on government voucher', kind: 'manual' },
  { no: 180, label: 'Other credits for the month (payments, sales tax, goods on hand)', kind: 'manual' },
  { no: 185, label: 'VAT due for the month (60 − 95 − 170 − 175 − 180, if positive)', kind: 'calc', total: true },
  { no: 190, label: 'VAT credit for the month (if negative)', kind: 'calc', total: true },
  { no: 195, label: 'Credit carried forward from previous month', kind: 'calc' },
  { no: 196, label: 'Refund given for excess credit', kind: 'manual' },
  { no: 197, label: 'Refund interest adjustment', kind: 'manual' },
  { no: 200, label: 'Net VAT payable', kind: 'calc', total: true, highlight: true },
  { no: 205, label: 'Credit carried forward to next month', kind: 'calc', total: true },
];

export const MANUAL_LINES = VAT_LINES.filter((l) => l.kind === 'manual').map((l) => l.no);
const OPENING_CREDIT_LINE = 195;

const PURCHASE_MAP: Record<number, [number, number | null]> = {
  1: [65, 70], 2: [75, 80], 7: [85, null], 3: [100, 105],
  4: [110, 115], 5: [120, 125], 6: [130, null],
};
const SALES_MAP: Record<number, [number, number | null]> = {
  1: [5, 10], 2: [15, null], 3: [20, null],
};

@Injectable()
export class VatService {
  constructor(
    @InjectRepository(VatAdjustmentEntity) private readonly vatAdjRepo: Repository<VatAdjustmentEntity>,
    @InjectRepository(InvoiceEntity) private readonly invoiceRepo: Repository<InvoiceEntity>,
  ) {}

  public async vatDeclaration(fy: number) {
    fy = +fy;
    const months = FY_MONTHS.map(() => Object.fromEntries(VAT_LINES.map((l) => [l.no, 0])));
    const ds = this.vatAdjRepo.getDataSource();

    const rows = ds.query<any>(
      `SELECT i.kind, i.fy_month, l.tx_type, SUM(l.taxable_amount) AS base, SUM(l.vat_amount) AS vat
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.fy = ? GROUP BY i.kind, i.fy_month, l.tx_type`,
      [fy],
    );

    for (const r of rows) {
      const map = r.kind === 'S' ? SALES_MAP : PURCHASE_MAP;
      const [baseLine, vatLine] = map[r.tx_type] || [];
      if (!baseLine) continue;
      months[r.fy_month][baseLine] += r.base;
      if (vatLine) months[r.fy_month][vatLine] += r.vat;
    }

    const adj = ds.query<any>('SELECT fy_month, line_no, amount FROM vat_adjustments WHERE fy = ?', [fy]);
    const openingCredit = adj.find((a) => a.fy_month === 0 && a.line_no === OPENING_CREDIT_LINE);
    for (const a of adj) {
      if (MANUAL_LINES.includes(a.line_no)) months[a.fy_month][a.line_no] = a.amount;
    }

    let carried = openingCredit ? openingCredit.amount : 0;
    for (const m of months) {
      m[55] = m[5] + m[15] + m[20] + m[25] + m[35] - m[45];
      m[60] = m[10] + m[30] + m[40] - m[50];
      m[90] = m[65] + m[75] + m[85];
      m[95] = m[70] + m[80];
      m[165] = m[100] + m[110] + m[120] + m[130] + m[135] + m[145] - m[155];
      m[170] = m[105] + m[115] + m[125] + m[140] + m[150] - m[160];
      const x = m[60] - m[95] - m[170] - m[175] - m[180];
      m[185] = x > 0 ? x : 0;
      m[190] = x < 0 ? -x : 0;
      m[195] = carried;
      const balance = m[185] - m[190] - m[195] + m[196] + m[197];
      m[200] = balance > 0 ? balance : 0;
      m[205] = balance < 0 ? -balance : 0;
      carried = m[205];
      for (const k of Object.keys(m)) m[k] = round2(m[k]);
    }

    const lines = VAT_LINES.map((l) => {
      const values = months.map((m) => m[l.no]);
      const total = l.no === 195 ? values[0] : l.no === 205 ? values[11] : round2(values.reduce((a, b) => a + b, 0));
      return { ...l, values, total };
    });

    return { fy, months: FY_MONTHS, lines, openingCredit: openingCredit ? openingCredit.amount : 0 };
  }

  public async saveVatAdjustments(fy: number, items: any[]) {
    const ds = this.vatAdjRepo.getDataSource();
    ds.transaction(() => {
      for (const it of items) {
        const line = +it.line_no;
        const month = +it.fy_month;
        const allowed = MANUAL_LINES.includes(line) || (line === OPENING_CREDIT_LINE && month === 0);
        if (!allowed || month < 0 || month > 11) throw new BadRequestException(`Line ${line} cannot be edited`);
        const amount = Number(it.amount);
        if (!Number.isFinite(amount)) throw new BadRequestException(`Invalid amount for line ${line}`);

        ds.execute(
          `INSERT INTO vat_adjustments (fy, fy_month, line_no, amount) VALUES (?,?,?,?)
           ON CONFLICT (fy, fy_month, line_no) DO UPDATE SET amount = excluded.amount`,
          [+fy, month, line, round2(amount)],
        );
      }
    });
    return this.vatDeclaration(fy);
  }

  public async getFiscalYears(): Promise<number[]> {
    const rows = this.invoiceRepo.getDataSource().query<{ fy: number }>('SELECT DISTINCT fy FROM invoices ORDER BY fy DESC');
    const cur = currentFiscalYear();
    return [...new Set([cur, ...rows.map((r) => r.fy)])].sort((a, b) => b - a);
  }
}
