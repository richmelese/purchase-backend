import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { LookupEntity } from '../../entities/lookup.entity.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { InvoiceLineEntity } from '../../entities/invoice-line.entity.js';
import { ProductEntity } from '../../entities/product.entity.js';
import { StockIssueEntity } from '../../entities/stock-issue.entity.js';
import { PaymentEntity } from '../../entities/payment.entity.js';

export const LIST_DEFS = [
  { list: 'payment_type', title: 'Payment Type', sheet: 'A', editable: false },
  { list: 'vat_category', title: 'VAT Category', sheet: 'B', editable: false },
  { list: 'calendar_type', title: 'Calendar Type', sheet: 'C', editable: false },
  { list: 'purchase_type', title: 'Input Category (Type of Purchase)', sheet: 'D', editable: false, numeric: true },
  { list: 'receipt_type', title: 'Receipt Type', sheet: 'E', editable: true },
  { list: 'unit', title: 'Unit of Measurement', sheet: 'F', editable: true, numeric: true },
  { list: 'wh_receipt_type', title: 'WH Receipt Type', sheet: 'H', editable: false },
  { list: 'transaction_type', title: 'Tax Type (Transaction Type)', sheet: 'I', editable: false },
  { list: 'report_status', title: 'Declaration Status', sheet: 'J', editable: false },
  { list: 'sales_type', title: 'Type of Sales', sheet: 'K', editable: false, numeric: true },
  { list: 'product_category', title: 'Product Category', editable: true },
  { list: 'department', title: 'Department', editable: true },
  { list: 'payment_method', title: 'Payment Method', editable: true },
  { list: 'bank', title: 'Banks (Ethiopian)', editable: true },
];

const SEED: Record<string, any[]> = {
  payment_type: [['Cash', 'Cash'], ['Credit', 'Credit']],
  vat_category: [['G', 'Goods'], ['S', 'Service']],
  calendar_type: [['E', 'E – Ethiopian'], ['G', 'G – Gregorian']],
  purchase_type: [
    ['1', 'Local Purchase Capital Asset [65]'],
    ['2', 'Imported Capital Asset [75]'],
    ['7', 'Purchase No VAT or Unclaimed Input – capital [85]'],
    ['3', 'Local Purchase Input [100]'],
    ['4', 'Imported Input [110]'],
    ['5', 'General Expense Input Purchase [120]'],
    ['6', 'Purchase No VAT or Unclaimed Input [130]'],
  ],
  receipt_type: [
    ['MRC', 'MRC – Cash Registration Machine (receipt no. starts with FS)', 1],
    ['Manual', 'Manual (receipt no. starts with M)', 1],
    ['Electronics', 'Electronics'],
  ],
  unit: [
    ['2', 'KG'], ['3', 'ML'], ['4', 'GM'], ['5', 'LIT'],
    ['6', 'MT'], ['7', 'PCS'], ['8', 'CT'], ['9', 'OTHER'], ['10', 'PC'],
  ],
  wh_receipt_type: [
    ['With Receipt', 'With Receipt'], ['Without Receipt', 'Without Receipt'],
    ['Government', 'Government'], ['Exempt', 'Exempt'],
  ],
  transaction_type: [
    ['Vatable', 'Vatable (15%)'], ['Non-Vatable', 'Non-Vatable (0%)'],
    ['Zero Rated', 'Zero Rated (0%)'], ['Tax Exempt', 'Tax Exempt'],
  ],
  report_status: [['Reported', 'Reported'], ['Not Reported', 'Not Reported']],
  sales_type: [
    ['1', 'Taxable Sale [5]'],
    ['2', 'Zero Rated Sale [15]'],
    ['3', 'Tax Exempted Sale [20]'],
  ],
  product_category: [
    ['Expense', 'Expense'], ['Computers', 'Computers'], ['Networking', 'Networking'],
    ['Storage', 'Storage'], ['Accessories', 'Accessories'], ['Printing & Toner', 'Printing & Toner'],
    ['Power', 'Power'], ['Other', 'Other'],
  ],
  department: [
    ['Administration', 'Administration'], ['Finance', 'Finance'],
    ['Sales', 'Sales'], ['IT', 'IT'], ['Store', 'Store'],
  ],
  payment_method: [
    ['Bank transfer', 'Bank transfer'], ['Cash', 'Cash'],
    ['Cheque', 'Cheque'], ['Mobile money', 'Mobile money'],
  ],
  bank: [
    ['CBE', 'Commercial Bank Of Ethiopia'],
    ['Awash', 'Awash Bank'],
    ['BOA', 'Bank of Abyssinia'],
    ['Dashen', 'Dashen Bank'],
    ['Hibret', 'Hibret Bank'],
    ['Wegagen', 'Wegagen Bank'],
    ['NIB', 'Nib International Bank'],
    ['Zemen', 'Zemen Bank'],
    ['CooP', 'Cooperative Bank of Oromia'],
    ['Abay', 'Abay Bank'],
    ['AIB', 'Addis International Bank'],
    ['Amhara', 'Amhara Bank'],
    ['Berhan', 'Berhan Bank'],
    ['BIB', 'Bunna International Bank'],
    ['Enat', 'Enat Bank'],
    ['GBE', 'Global Bank Ethiopia'],
    ['LIB', 'Lion International Bank'],
    ['Oromia', 'Oromia Bank'],
    ['Siinqee', 'Siinqee Bank (Interest-free/Islamic banking)'],
    ['ZBB', 'ZamZam Bank (Interest-free/Islamic banking)'],
    ['Hijra', 'Hijra Bank (Mortgage-focused)'],
    ['GBB', 'Goh Betoch Bank'],
    ['Ahadu', 'Ahadu Bank'],
  ],
};

@Injectable()
export class LookupsService {
  constructor(
    @InjectRepository(LookupEntity) private readonly lookupRepo: Repository<LookupEntity>,
    @InjectRepository(InvoiceEntity) private readonly invoiceRepo: Repository<InvoiceEntity>,
    @InjectRepository(InvoiceLineEntity) private readonly lineRepo: Repository<InvoiceLineEntity>,
    @InjectRepository(ProductEntity) private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(StockIssueEntity) private readonly issueRepo: Repository<StockIssueEntity>,
    @InjectRepository(PaymentEntity) private readonly paymentRepo: Repository<PaymentEntity>,
  ) {
    this.seedDefaults();
  }

  private seedDefaults() {
    const ds = this.lookupRepo.getDataSource();
    for (const def of LIST_DEFS) {
      if (SEED[def.list]) {
        SEED[def.list].forEach(([value, label, lockedItem], i) => {
          ds.execute(
            'INSERT OR IGNORE INTO lookups (list, value, label, sort, locked) VALUES (?,?,?,?,?)',
            [def.list, value, label, (i + 1) * 10, def.editable ? (lockedItem ? 1 : 0) : 1],
          );
          if (!def.editable) {
            ds.execute('UPDATE lookups SET label = ?, sort = ?, locked = 1 WHERE list = ? AND value = ?', [label, (i + 1) * 10, def.list, value]);
          }
        });
      }
    }
  }

  public async getLookups() {
    const rows = await this.lookupRepo.find({ order: { list: 'ASC', sort: 'ASC', value: 'ASC' } });
    const out: Record<string, any[]> = {};
    for (const def of LIST_DEFS) out[def.list] = [];
    for (const r of rows) {
      if (!out[r.list]) continue;
      const def = LIST_DEFS.find((d) => d.list === r.list);
      out[r.list].push({
        value: def?.numeric ? Number(r.value) : r.value,
        label: r.label,
        locked: !!r.locked,
      });
    }
    return {
      lists: LIST_DEFS.map(({ list, title, sheet, editable, numeric }) => ({
        list,
        title,
        sheet,
        editable,
        numeric: !!numeric,
      })),
      values: out,
    };
  }

  public async lookupValues(list: string): Promise<string[]> {
    const rows = await this.lookupRepo.find({ where: { list } });
    return rows.map((r) => r.value);
  }

  public async unitLabels(): Promise<Record<number, string>> {
    const rows = await this.lookupRepo.find({ where: { list: 'unit' } });
    return Object.fromEntries(rows.map((r) => [+r.value, r.label]));
  }

  private editableDef(list: string) {
    const def = LIST_DEFS.find((d) => d.list === list);
    if (!def) throw new NotFoundException('Unknown list');
    if (!def.editable) throw new BadRequestException(`${def.title} is fixed by the tax rules and cannot be changed`);
    return def;
  }

  public async addLookup(list: string, input: any) {
    const def = this.editableDef(list);
    const label = String(input.label ?? '').trim();
    let value = String(input.value ?? '').trim();

    if (def.numeric) {
      const maxRow = this.lookupRepo.queryOne<{ m: number }>('SELECT MAX(CAST(value AS INTEGER)) AS m FROM lookups WHERE list = ?', [list]);
      const max = maxRow?.m || 0;
      value = value || String(max + 1);
      if (!/^\d+$/.test(value)) throw new BadRequestException({ message: 'ID must be a whole number', fields: { value: 'Number' } });
    } else {
      value = value || label;
    }
    if (!label) throw new BadRequestException({ message: 'Name is required', fields: { label: 'Required' } });

    const sortRow = this.lookupRepo.queryOne<{ m: number }>('SELECT MAX(sort) AS m FROM lookups WHERE list = ?', [list]);
    const sort = (sortRow?.m || 0) + 10;

    try {
      await this.lookupRepo.insert({ list, value, label, sort, locked: 0 });
    } catch (e: any) {
      if (/UNIQUE|PRIMARY/.test(e.message)) {
        throw new ConflictException({ message: `“${value}” already exists in ${def.title}`, fields: { value: 'Already exists' } });
      }
      throw e;
    }
    return (await this.getLookups()).values;
  }

  public async renameLookup(list: string, value: string, input: any) {
    const def = this.editableDef(list);
    const label = String(input.label ?? '').trim();
    if (!label) throw new BadRequestException({ message: 'Name is required', fields: { label: 'Required' } });

    const row = await this.lookupRepo.findOne({ where: { list, value: String(value) } });
    if (!row) throw new NotFoundException('Not found');

    const ds = this.lookupRepo.getDataSource();
    ds.transaction(() => {
      ds.execute('UPDATE lookups SET label = ? WHERE list = ? AND value = ?', [label, list, String(value)]);
      if (!def.numeric && !row.locked && label !== row.value) {
        const exist = ds.queryOne('SELECT 1 FROM lookups WHERE list = ? AND value = ?', [list, label]);
        if (exist) throw new ConflictException(`“${label}” already exists`);
        ds.execute('UPDATE lookups SET value = ? WHERE list = ? AND value = ?', [label, list, row.value]);

        const carry: Record<string, string> = {
          receipt_type: 'UPDATE invoices SET receipt_type = ? WHERE receipt_type = ?',
          product_category: 'UPDATE products SET category = ? WHERE category = ?',
          department: 'UPDATE stock_issues SET department = ? WHERE department = ?',
          payment_method: 'UPDATE payments SET method = ? WHERE method = ?',
        };
        if (carry[list]) ds.execute(carry[list], [label, row.value]);
      }
    });

    return (await this.getLookups()).values;
  }

  public async moveLookup(list: string, value: string, dir: 'up' | 'down') {
    this.editableDef(list);
    const rows = (await this.lookupRepo.find({ where: { list }, order: { sort: 'ASC', value: 'ASC' } })).map((r) => r.value);
    const i = rows.indexOf(String(value));
    const j = i + (dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= rows.length) return (await this.getLookups()).values;

    [rows[i], rows[j]] = [rows[j], rows[i]];
    const ds = this.lookupRepo.getDataSource();
    ds.transaction(() => {
      rows.forEach((v, k) => ds.execute('UPDATE lookups SET sort = ? WHERE list = ? AND value = ?', [(k + 1) * 10, list, v]));
    });

    return (await this.getLookups()).values;
  }

  public async deleteLookup(list: string, value: string) {
    this.editableDef(list);
    const row = await this.lookupRepo.findOne({ where: { list, value: String(value) } });
    if (!row) throw new NotFoundException('Not found');
    if (row.locked) throw new BadRequestException(`“${row.label}” is required by the system and cannot be removed`);

    const ds = this.lookupRepo.getDataSource();
    let used = 0;
    if (list === 'unit') {
      const u = ds.queryOne<{ n: number }>('SELECT (SELECT COUNT(*) FROM products WHERE unit = ?) + (SELECT COUNT(*) FROM invoice_lines WHERE unit = ?) AS n', [+value, +value]);
      used = u?.n || 0;
    } else if (list === 'receipt_type') {
      const u = ds.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM invoices WHERE receipt_type = ?', [value]);
      used = u?.n || 0;
    } else if (list === 'product_category') {
      const u = ds.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE category = ?', [value]);
      used = u?.n || 0;
    } else if (list === 'department') {
      const u = ds.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM stock_issues WHERE department = ?', [value]);
      used = u?.n || 0;
    } else if (list === 'payment_method') {
      const u = ds.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM payments WHERE method = ?', [value]);
      used = u?.n || 0;
    }

    if (used) {
      throw new BadRequestException(`“${row.label}” is used by ${used} record(s) and cannot be removed`);
    }

    await this.lookupRepo.delete({ list, value: row.value });
    return (await this.getLookups()).values;
  }
}
