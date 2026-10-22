import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DataSource } from '../../orm/data-source.js';
import { SettingsService } from '../settings/settings.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { ProductsService } from '../products/products.service.js';
import { VatService } from '../vat/vat.service.js';
import { WithholdingService } from '../withholding/withholding.service.js';
import { CreditService } from '../credit/credit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { LookupsService, LIST_DEFS } from '../lookups/lookups.service.js';
import { FY_MONTHS, fiscalYearLabel } from '../../common/lib/ethiopian.js';

const MONEY = '#,##0.00;[Red]-#,##0.00';
const HEADER_FILL: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };

const norm = (s: any) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[.:]+$/, '')
    .trim();

function cellValue(cell: any) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((t: any) => t.text).join('');
    else if (v.text) v = v.text;
    else if (v.formula) v = null;
  }
  if (typeof v === 'string') {
    v = v.trim();
    if (/^select /i.test(v) || v === 'No Data' || v === '') return null;
  }
  return v ?? null;
}

function mapColumns(ws: any, fields: Record<string, string[]>, key: string) {
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    const headers: [number, string][] = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (c: any, col: number) => headers.push([col, norm(cellValue(c))]));
    const map: Record<string, number> = {};
    for (const [field, aliases] of Object.entries(fields)) {
      for (const a of aliases) {
        const hit = headers.find(([, h]) => h === a);
        if (hit) {
          map[field] = hit[0];
          break;
        }
      }
    }
    if (map[key]) return { headerRow: r, map };
  }
  return null;
}

async function openWorkbook(input: any) {
  const wb = new ExcelJS.Workbook();
  try {
    if (typeof input === 'string') await wb.xlsx.readFile(input);
    else await wb.xlsx.load(input);
  } catch {
    throw new BadRequestException('The file is not a valid .xlsx workbook');
  }
  return wb;
}

function findSheet(wb: any, preferred: string[], fields: Record<string, string[]>, key: string) {
  const order = [...wb.worksheets].sort(
    (a, b) => (preferred.includes(b.name) ? 1 : 0) - (preferred.includes(a.name) ? 1 : 0),
  );
  for (const ws of order) {
    const m = mapColumns(ws, fields, key);
    if (m) return { ws, ...m };
  }
  return null;
}

@Injectable()
export class ImportExportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly invoicesService: InvoicesService,
    private readonly productsService: ProductsService,
    private readonly vatService: VatService,
    private readonly withholdingService: WithholdingService,
    private readonly creditService: CreditService,
    private readonly inventoryService: InventoryService,
    private readonly reportsService: ReportsService,
    private readonly lookupsService: LookupsService,
  ) {}

  public async importProducts(input: any) {
    const wb = await openWorkbook(input);
    const fields = {
      code: ['product code', 'code'],
      name_en: ['product english name', 'english name', 'product name', 'name'],
      name_am: ['product amharic name', 'amharic name'],
      category: ['category'],
      brand: ['brand'],
      model: ['model'],
      serial_no: ['serial no', 'serial number', 'serial'],
      unit: ['unit', 'unit of measurement', 'unit of mesurment', 'uom'],
      min_stock: ['minimum stock', 'min stock', 'min'],
      opening_stock: ['opening stock', 'opening'],
      purchase_price: ['purchase price', 'unit cost', 'cost'],
      selling_price: ['selling price', 'sales price', 'price'],
      track_stock: ['track stock', 'stock tracked'],
    };

    const found = findSheet(wb, ['Product Lists', 'Products'], fields, 'code');
    if (!found || !found.map.name_en) {
      throw new BadRequestException('No sheet with “Product Code” and “Product English Name” columns was found');
    }
    const { ws, headerRow, map } = found;
    const labels = await this.lookupsService.unitLabels();
    const byLabel = Object.fromEntries(Object.entries(labels).map(([v, l]) => [l.toLowerCase(), +v]));
    const get = (row: any, f: string) => (map[f] ? cellValue(row.getCell(map[f])) : null);
    const num = (v: any) => {
      if (v == null || String(v).trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const unitOf = (v: any) => {
      if (v == null) return null;
      const s = String(v).trim();
      const m = /^(\d+)/.exec(s);
      if (m && labels[+m[1]]) return +m[1];
      return byLabel[s.toLowerCase()] || byLabel[s.replace(/^\d+\s*[-–]\s*/, '').toLowerCase()] || null;
    };

    const existingRows = this.dataSource.query<{ code: string }>('SELECT code FROM products');
    const existing = new Set(existingRows.map((r) => r.code));

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    this.dataSource.transaction(() => {
      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const code = String(get(row, 'code') ?? '').trim();
        const name_en = String(get(row, 'name_en') ?? '').trim();
        if (!code && !name_en) continue;
        if (/^total$/i.test(code)) continue; // totals row of an exported list
        if (!code || !name_en) {
          errors.push(`Row ${r}: both code and English name are required`);
          skipped += 1;
          continue;
        }
        // A column missing from the sheet (or a blank cell) is null, so an update keeps the stored value
        // (COALESCE) and only new products get the defaults below.
        const rawTrack = get(row, 'track_stock');
        const track = rawTrack == null || rawTrack === '' ? null
          : rawTrack === false || rawTrack === 0 || /^(0|no|false|n)$/i.test(String(rawTrack).trim()) ? 0 : 1;
        const vals = [
          name_en,
          get(row, 'name_am') ? String(get(row, 'name_am')).trim() : null,
          get(row, 'category') ? String(get(row, 'category')).trim() : null,
          get(row, 'brand') ? String(get(row, 'brand')).trim() : null,
          get(row, 'model') ? String(get(row, 'model')).trim() : null,
          get(row, 'serial_no') ? String(get(row, 'serial_no')).trim() : null,
          unitOf(get(row, 'unit')),
          track,
          num(get(row, 'min_stock')),
          num(get(row, 'opening_stock')),
          num(get(row, 'purchase_price')),
          num(get(row, 'selling_price')),
        ];
        if (existing.has(code)) {
          this.dataSource.execute(
            `UPDATE products SET name_en=COALESCE(?,name_en), name_am=COALESCE(?,name_am), category=COALESCE(?,category),
             brand=COALESCE(?,brand), model=COALESCE(?,model), serial_no=COALESCE(?,serial_no), unit=COALESCE(?,unit),
             track_stock=COALESCE(?,track_stock), min_stock=COALESCE(?,min_stock), opening_stock=COALESCE(?,opening_stock),
             purchase_price=COALESCE(?,purchase_price), selling_price=COALESCE(?,selling_price) WHERE code = ?`,
            [...vals, code],
          );
          updated += 1;
        } else {
          this.dataSource.execute(
            `INSERT INTO products (code, name_en, name_am, category, brand, model, serial_no, unit, track_stock, min_stock, opening_stock, purchase_price, selling_price)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            // New products: unit 7, stock-tracked, zero quantities and prices unless the sheet says otherwise.
            [code, ...vals.slice(0, 6), vals[6] ?? 7, vals[7] ?? 1, ...vals.slice(8).map((v) => v ?? 0)],
          );
          existing.add(code);
          added += 1;
        }
      }
    });

    return { sheet: ws.name, added, updated, skipped, errors: errors.slice(0, 20) };
  }

  public async importParties(input: any, defaultType = 'Supplier') {
    const wb = await openWorkbook(input);
    const fields = {
      name: ['company name', 'name', 'supplier name', 'customer name'],
      tin: ['company tin', 'tin', 'tin no', 'tin number'],
      mrc1: ['mrc 1', 'mrc-1', 'mrc1'],
      mrc2: ['mrc 2', 'mrc-2', 'mrc2'],
      mrc3: ['mrc 3', 'mrc-3', 'mrc3'],
      phone: ['phone no', 'phone', 'telephone', 'mobile'],
      email: ['email', 'e-mail'],
      address: ['address', 'location'],
      type: ['type', 'role'],
    };

    const found = findSheet(wb, ['Supplier Lists', 'Suppliers', 'Customers', 'Parties'], fields, 'name');
    if (!found) throw new BadRequestException('No sheet with “Company Name” column was found');
    const { ws, headerRow, map } = found;
    const get = (row: any, f: string) => (map[f] ? cellValue(row.getCell(map[f])) : null);
    const cleanTin = (v: any) => {
      if (!v) return null;
      const s = String(v).replace(/\D/g, '');
      return s.length ? s : null;
    };

    const byTin = new Map(this.dataSource.query<{ id: number; tin: string }>('SELECT id, tin FROM parties WHERE tin IS NOT NULL').map((r) => [r.tin, r.id]));
    const byName = new Map(this.dataSource.query<{ id: number; name: string }>('SELECT id, name FROM parties').map((r) => [r.name.toLowerCase(), r.id]));

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    this.dataSource.transaction(() => {
      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const name = String(get(row, 'name') ?? '').trim();
        if (!name) continue;
        const tin = cleanTin(get(row, 'tin'));
        const typeRaw = String(get(row, 'type') ?? '').toLowerCase();
        // The sheet's own type, if it has one. Without it an existing company keeps its type and only a new
        // one gets the type of the list being imported.
        const sheetType = typeRaw.includes('cust') ? 'Customer' : typeRaw.includes('both') ? 'Both' : typeRaw.includes('supp') ? 'Supplier' : null;
        const mrc1 = get(row, 'mrc1') ? String(get(row, 'mrc1')).trim() : null;
        const mrc2 = get(row, 'mrc2') ? String(get(row, 'mrc2')).trim() : null;
        const mrc3 = get(row, 'mrc3') ? String(get(row, 'mrc3')).trim() : null;
        const phone = get(row, 'phone') ? String(get(row, 'phone')).trim() : null;
        const email = get(row, 'email') ? String(get(row, 'email')).trim() : null;
        const address = get(row, 'address') ? String(get(row, 'address')).trim() : null;

        const targetId = (tin && byTin.get(tin)) || byName.get(name.toLowerCase());
        if (targetId) {
          this.dataSource.execute(
            `UPDATE parties SET name=COALESCE(?,name), type=COALESCE(?,type), mrc1=COALESCE(?,mrc1),
             mrc2=COALESCE(?,mrc2), mrc3=COALESCE(?,mrc3), phone=COALESCE(?,phone),
             email=COALESCE(?,email), address=COALESCE(?,address) WHERE id = ?`,
            [name, sheetType, mrc1, mrc2, mrc3, phone, email, address, targetId],
          );
          updated += 1;
        } else {
          try {
            const res = this.dataSource.execute(
              'INSERT INTO parties (tin, name, type, mrc1, mrc2, mrc3, phone, email, address) VALUES (?,?,?,?,?,?,?,?,?)',
              [tin, name, sheetType ?? defaultType, mrc1, mrc2, mrc3, phone, email, address],
            );
            const id = Number(res.lastInsertRowid);
            if (tin) byTin.set(tin, id);
            byName.set(name.toLowerCase(), id);
            added += 1;
          } catch (e: any) {
            errors.push(`Row ${r}: ${e.message}`);
            skipped += 1;
          }
        }
      }
    });

    return { sheet: ws.name, added, updated, skipped, errors: errors.slice(0, 20) };
  }

  private async addSheet(wb: any, name: string, title: string, columns: any[], rows: any[], { totals = [] }: any = {}) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
    const s = await this.settingsService.getSettings();
    ws.mergeCells(1, 1, 1, columns.length);
    ws.getCell(1, 1).value = `${s.company_name}${s.company_tin ? ` (TIN ${s.company_tin})` : ''} — ${title}`;
    ws.getCell(1, 1).font = { bold: true, size: 13 };
    ws.getCell(2, 1).value = `Generated ${new Date().toLocaleString()}`;
    ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

    const header = ws.getRow(3);
    columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = c.width || 14;
      if (c.money) ws.getColumn(i + 1).numFmt = MONEY;
      if (c.date) ws.getColumn(i + 1).numFmt = 'mm/dd/yyyy';
    });
    header.height = 32;

    for (const r of rows) {
      ws.addRow(
        columns.map((c) => {
          const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
          if (c.date && v) return new Date(`${v}T00:00:00Z`);
          return v ?? '';
        }),
      );
    }
    if (totals.length && rows.length) {
      const first = 4;
      const last = 3 + rows.length;
      const row = ws.addRow(
        columns.map((c, i) => {
          if (i === 0) return 'TOTAL';
          if (!totals.includes(c.key)) return '';
          const col = ws.getColumn(i + 1).letter;
          return { formula: `SUM(${col}${first}:${col}${last})` };
        }),
      );
      row.font = { bold: true };
      row.eachCell((c: any) => {
        c.border = { top: { style: 'thin' } };
      });
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
    return ws;
  }

  public async buildExport(type: string, filter: any = {}, user?: any) {
    const wb = new ExcelJS.Workbook();
    const fy = filter.fy || 2019;
    const tag = `FY${fy}${filter.month !== undefined && filter.month !== '' ? `-${FY_MONTHS[+filter.month]}` : ''}`;

    const labels = await this.lookupsService.unitLabels();
    const detailCols = (kind: 'P' | 'S') => {
      const party = kind === 'P' ? 'Seller' : 'Buyer';
      return [
        { header: `${kind === 'P' ? 'Purchase' : 'Sales'} ID`, value: (r: any) => r.inv?.invoice_no, width: 12 },
        { header: 'Payment Type', value: (r: any) => r.inv?.payment_type, width: 10 },
        { header: 'Product Type', value: (r: any) => (r.inv?.vat_category === 'S' ? 'Service' : 'Goods'), width: 9 },
        { header: 'Calendar Type', value: (r: any) => r.inv?.calendar_type, width: 9 },
        { header: `${party} TIN`, value: (r: any) => r.inv?.party_tin, width: 13 },
        { header: `${party} Name`, value: (r: any) => r.inv?.party_name, width: 26 },
        { header: `Date`, value: (r: any) => r.inv?.date, date: true, width: 12 },
        { header: 'Ethiopian Month', value: (r: any) => FY_MONTHS[r.inv?.fy_month] || '', width: 11 },
        { header: 'Receipt Type', value: (r: any) => r.inv?.receipt_type, width: 11 },
        { header: 'Receipt No', value: (r: any) => r.inv?.vat_receipt_no, width: 13 },
        { header: 'Product Code', key: 'product_code', width: 12 },
        { header: 'Item Name', key: 'description', width: 30 },
        { header: 'Measurement', value: (r: any) => labels[r.unit] || r.unit, width: 10 },
        { header: 'Quantity', key: 'qty', width: 9 },
        { header: 'Unit Price', key: 'unit_price', money: true },
        { header: 'Total Price', key: 'total', money: true },
        { header: 'Taxable Amount', key: 'taxable_amount', money: true },
        { header: 'VAT', key: 'vat_amount', money: true },
        { header: 'Grand Total', key: 'line_total', money: true },
      ];
    };

    const summaryCols = (kind: 'P' | 'S') => {
      const party = kind === 'P' ? 'Seller' : 'Buyer';
      return [
        { header: `${kind === 'P' ? 'Purchase' : 'Sales'} ID`, key: 'invoice_no', width: 12 },
        { header: 'Payment Type', key: 'payment_type', width: 12 },
        { header: 'VAT Category', value: (r: any) => (r.vat_category === 'S' ? 'Service' : 'Goods'), width: 10 },
        { header: 'Calendar Type', key: 'calendar_type', width: 10 },
        { header: `${party} TIN`, key: 'party_tin', width: 14 },
        { header: `${party} Name`, key: 'party_name', width: 28 },
        { header: 'Date', key: 'date', date: true, width: 12 },
        { header: 'Ethiopian Month', value: (r: any) => FY_MONTHS[r.fy_month] || '', width: 12 },
        { header: 'Receipt Type', key: 'receipt_type', width: 12 },
        { header: 'Receipt No', key: 'vat_receipt_no', width: 14 },
        { header: 'Taxable Amount', key: 'taxable_amount', money: true },
        { header: 'VAT Amount', key: 'vat_amount', money: true },
        { header: 'Grand Total', key: 'grand_total', money: true },
        { header: 'WH Status', value: (r: any) => r.wh?.status || '', width: 12 },
        { header: 'WH Expected', value: (r: any) => r.wh?.expected || 0, money: true },
        { header: 'Amount Due', key: 'amount_due', money: true },
        { header: 'Amount Paid', key: 'amount_paid', money: true },
        { header: 'Balance', key: 'balance', money: true },
        { header: 'Report Status', key: 'report_status', width: 12 },
      ];
    };

    const whCols = (kind: 'P' | 'S') => [
      { header: `${kind === 'P' ? 'Purchase' : 'Sales'} ID`, key: 'invoice_no', width: 12 },
      { header: 'Date', key: 'date', date: true, width: 12 },
      { header: 'Month', value: (r: any) => FY_MONTHS[r.fy_month] || '', width: 12 },
      { header: kind === 'P' ? 'Seller Name' : 'Buyer Name', key: 'party_name', width: 28 },
      { header: 'TIN', key: 'party_tin', width: 14 },
      { header: 'WH Status', value: (r: any) => r.wh?.status || '', width: 12 },
      { header: 'Receipt Status', key: 'wh_receipt_type', width: 14 },
      { header: 'WH Base', key: 'base', value: (r: any) => r.wh?.base || 0, money: true },
      { header: 'Expected WH', key: 'expected', value: (r: any) => r.wh?.expected || 0, money: true },
      { header: 'WH Receipt No', key: 'wh_receipt_no', width: 14 },
      { header: 'WH Receipt Date', key: 'wh_receipt_date', date: true, width: 14 },
      { header: 'WH Month', key: 'wh_month', width: 12 },
      { header: 'Paid', key: 'paid', value: (r: any) => r.wh?.paid || 0, money: true },
      { header: 'Outstanding', key: 'outstanding', value: (r: any) => r.wh?.outstanding || 0, money: true },
      { header: 'Check', key: 'penalty', width: 14 },
    ];

    const creditCols = (kind: 'P' | 'S') => [
      { header: `${kind === 'P' ? 'Purchase' : 'Sales'} ID`, key: 'invoice_no', width: 12 },
      { header: 'Date', key: 'date', date: true, width: 12 },
      { header: kind === 'P' ? 'Seller Name' : 'Buyer Name', key: 'party_name', width: 28 },
      { header: 'TIN', key: 'party_tin', width: 14 },
      { header: 'Amount Due', key: 'amount_due', money: true },
      { header: 'Amount Paid', key: 'amount_paid', money: true },
      { header: 'Balance', key: 'balance', money: true },
      { header: 'Age (Days)', key: 'age_days', width: 10 },
      { header: 'Aging Bucket', key: 'age_bucket', width: 12 },
    ];

    const getFlattenedLines = async (kind: 'P' | 'S') => {
      const invs = await this.invoicesService.listInvoices({ kind, ...filter }, user);
      const full = await Promise.all(invs.map((inv) => this.invoicesService.getInvoice(inv.id)));
      const lines: any[] = [];
      for (const inv of full) {
        if (inv.lines && inv.lines.length) {
          for (const l of inv.lines) {
            lines.push({ ...l, inv });
          }
        } else {
          lines.push({ inv });
        }
      }
      return { invs: full, lines };
    };

    switch (type) {
      case 'purchases': {
        const { invs, lines } = await getFlattenedLines('P');
        await this.addSheet(wb, 'P. Detail', 'Purchase Invoices (Detail)', detailCols('P'), lines, {
          totals: ['total', 'taxable_amount', 'vat_amount', 'line_total'],
        });
        await this.addSheet(wb, 'P. Summary', 'Purchase Summary', summaryCols('P'), invs, {
          totals: ['taxable_amount', 'vat_amount', 'grand_total', 'amount_due', 'amount_paid', 'balance'],
        });
        return { buffer: await wb.xlsx.writeBuffer(), filename: `Purchases-${tag}.xlsx` };
      }
      case 'sales': {
        const { invs, lines } = await getFlattenedLines('S');
        await this.addSheet(wb, 'S. Detail', 'Sales Invoices (Detail)', detailCols('S'), lines, {
          totals: ['total', 'taxable_amount', 'vat_amount', 'line_total'],
        });
        await this.addSheet(wb, 'S. Summary', 'Sales Summary', summaryCols('S'), invs, {
          totals: ['taxable_amount', 'vat_amount', 'grand_total', 'amount_due', 'amount_paid', 'balance'],
        });
        return { buffer: await wb.xlsx.writeBuffer(), filename: `Sales-${tag}.xlsx` };
      }
      case 'vat': {
        const dec = await this.vatService.vatDeclaration(fy);
        const cols = [
          { header: 'Line', key: 'no', width: 8 },
          { header: 'Description', key: 'label', width: 44 },
          ...FY_MONTHS.map((m, i) => ({ header: m, value: (r: any) => r.values[i], money: true, width: 14 })),
          { header: 'Total', key: 'total', money: true, width: 16 },
        ];
        await this.addSheet(wb, 'VAT Declaration', `VAT Declaration — ${fiscalYearLabel(fy)}`, cols, dec.lines);
        return { buffer: await wb.xlsx.writeBuffer(), filename: `VAT-Declaration-FY${fy}.xlsx` };
      }
      case 'stock': {
        const rows = await this.productsService.stockReport();
        const cols = [
          { header: 'Code', key: 'code', width: 12 },
          { header: 'Name', key: 'name_en', width: 30 },
          { header: 'Category', key: 'category', width: 14 },
          { header: 'Current Stock', key: 'current_stock', width: 12 },
          { header: 'Unit Cost', key: 'unit_cost', money: true },
          { header: 'Stock Value', key: 'stock_value', money: true },
          { header: 'Status', key: 'status', width: 12 },
        ];
        await this.addSheet(wb, 'Current Stock', 'Stock on Hand & Valuation', cols, rows, { totals: ['stock_value'] });
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Current-Stock.xlsx' };
      }
      case 'withholding': {
        const pWh = await this.withholdingService.withholdingReport({ kind: 'P', ...filter }, user);
        const sWh = await this.withholdingService.withholdingReport({ kind: 'S', ...filter }, user);
        await this.addSheet(wb, 'P WH', 'Withholding on Purchases (We Withhold)', whCols('P'), pWh, {
          totals: ['base', 'expected', 'paid', 'outstanding'],
        });
        await this.addSheet(wb, 'S WH', 'Withholding on Sales (Withheld from Us)', whCols('S'), sWh, {
          totals: ['base', 'expected', 'paid', 'outstanding'],
        });
        return { buffer: await wb.xlsx.writeBuffer(), filename: `Withholding-${tag}.xlsx` };
      }
      case 'credit': {
        const pCredit = await this.creditService.creditReport({ kind: 'P', open: false }, user);
        const sCredit = await this.creditService.creditReport({ kind: 'S', open: false }, user);
        await this.addSheet(wb, 'Payables', 'Credit Purchases (Payables & Aging)', creditCols('P'), pCredit, {
          totals: ['amount_due', 'amount_paid', 'balance'],
        });
        await this.addSheet(wb, 'Receivables', 'Credit Sales (Receivables & Aging)', creditCols('S'), sCredit, {
          totals: ['amount_due', 'amount_paid', 'balance'],
        });
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Credit-Report.xlsx' };
      }
      case 'all': {
        // 1. P. Detail & P. Summary
        const p = await getFlattenedLines('P');
        await this.addSheet(wb, 'P. Detail', 'Purchase Invoices (Detail)', detailCols('P'), p.lines, {
          totals: ['total', 'taxable_amount', 'vat_amount', 'line_total'],
        });
        await this.addSheet(wb, 'P. Summary', 'Purchase Summary', summaryCols('P'), p.invs, {
          totals: ['taxable_amount', 'vat_amount', 'grand_total', 'amount_due', 'amount_paid', 'balance'],
        });

        // 2. S. Detail & S. Summary
        const s = await getFlattenedLines('S');
        await this.addSheet(wb, 'S. Detail', 'Sales Invoices (Detail)', detailCols('S'), s.lines, {
          totals: ['total', 'taxable_amount', 'vat_amount', 'line_total'],
        });
        await this.addSheet(wb, 'S. Summary', 'Sales Summary', summaryCols('S'), s.invs, {
          totals: ['taxable_amount', 'vat_amount', 'grand_total', 'amount_due', 'amount_paid', 'balance'],
        });

        // 3. P WH & S WH
        const pWh = await this.withholdingService.withholdingReport({ kind: 'P', ...filter }, user);
        const sWh = await this.withholdingService.withholdingReport({ kind: 'S', ...filter }, user);
        await this.addSheet(wb, 'P WH', 'Withholding on Purchases (We Withhold)', whCols('P'), pWh, {
          totals: ['wh.base', 'wh.expected', 'wh.paid', 'wh.outstanding'],
        });
        await this.addSheet(wb, 'S WH', 'Withholding on Sales (Withheld from Us)', whCols('S'), sWh, {
          totals: ['wh.base', 'wh.expected', 'wh.paid', 'wh.outstanding'],
        });

        // 4. VAT Declaration
        const dec = await this.vatService.vatDeclaration(fy);
        const vatCols = [
          { header: 'Line', key: 'no', width: 8 },
          { header: 'Description', key: 'label', width: 44 },
          ...FY_MONTHS.map((m, i) => ({ header: m, value: (r: any) => r.values[i], money: true, width: 14 })),
          { header: 'Total', key: 'total', money: true, width: 16 },
        ];
        await this.addSheet(wb, 'VAT Declaration', `VAT Declaration — ${fiscalYearLabel(fy)}`, vatCols, dec.lines);

        // 5. Current Stock
        const stockRows = await this.productsService.stockReport();
        const stockCols = [
          { header: 'Code', key: 'code', width: 12 },
          { header: 'Name', key: 'name_en', width: 30 },
          { header: 'Category', key: 'category', width: 14 },
          { header: 'Current Stock', key: 'current_stock', width: 12 },
          { header: 'Unit Cost', key: 'unit_cost', money: true },
          { header: 'Stock Value', key: 'stock_value', money: true },
          { header: 'Status', key: 'status', width: 12 },
        ];
        await this.addSheet(wb, 'Current Stock', 'Stock on Hand & Valuation', stockCols, stockRows, { totals: ['stock_value'] });

        // 6. Payables & Receivables
        const pCredit = await this.creditService.creditReport({ kind: 'P', open: false }, user);
        const sCredit = await this.creditService.creditReport({ kind: 'S', open: false }, user);
        await this.addSheet(wb, 'Payables', 'Credit Purchases (Payables & Aging)', creditCols('P'), pCredit, {
          totals: ['amount_due', 'amount_paid', 'balance'],
        });
        await this.addSheet(wb, 'Receivables', 'Credit Sales (Receivables & Aging)', creditCols('S'), sCredit, {
          totals: ['amount_due', 'amount_paid', 'balance'],
        });

        // 7. Monthly Summary
        const rMonthly = await this.reportsService.monthlySummary(fy, user);
        const monthlyCols = [
          { header: 'Month', key: 'month', width: 12 },
          { header: 'Sales', key: 'sales', money: true },
          { header: 'Output VAT', key: 'output_vat', money: true },
          { header: 'Purchases', key: 'purchases', money: true },
          { header: 'Input VAT', key: 'input_vat', money: true },
          { header: 'Net VAT', key: 'net_vat', money: true },
        ];
        await this.addSheet(wb, 'Monthly Summary', `Monthly summary — ${fiscalYearLabel(fy)}`, monthlyCols, rMonthly.rows, {
          totals: ['sales', 'output_vat', 'purchases', 'input_vat', 'net_vat'],
        });

        return { buffer: await wb.xlsx.writeBuffer(), filename: `All-In-One-${tag}.xlsx` };
      }
      default:
        throw new NotFoundException('Unknown export type');
    }
  }

  public async buildListExport(list: string) {
    const wb = new ExcelJS.Workbook();
    switch (list) {
      case 'products': {
        const rows = await this.productsService.stockReport();
        const cols = [
          { header: 'Code', key: 'code', width: 14 },
          { header: 'English Name', key: 'name_en', width: 32 },
          { header: 'Category', key: 'category', width: 16 },
          { header: 'Opening Stock', key: 'opening_stock', width: 12 },
          { header: 'Current Stock', key: 'current_stock', width: 12 },
          { header: 'Purchase Price', key: 'purchase_price', money: true },
          { header: 'Selling Price', key: 'selling_price', money: true },
          { header: 'Stock Value', key: 'stock_value', money: true },
        ];
        await this.addSheet(wb, 'Products', 'Product Master List', cols, rows, { totals: ['stock_value'] });
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Product-List.xlsx' };
      }
      case 'parties': {
        const rows = this.dataSource.query('SELECT * FROM parties ORDER BY type, name');
        const cols = [
          { header: 'TIN', key: 'tin', width: 14 },
          { header: 'Name', key: 'name', width: 34 },
          { header: 'Type', key: 'type', width: 12 },
          { header: 'Phone', key: 'phone', width: 14 },
          { header: 'Email', key: 'email', width: 24 },
          { header: 'Address', key: 'address', width: 30 },
        ];
        await this.addSheet(wb, 'Companies', 'Supplier & Customer Profiles', cols, rows);
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Supplier-List.xlsx' };
      }
      case 'stock-in': {
        const rows = await this.inventoryService.stockIn();
        const cols = [
          { header: 'Date', key: 'date', date: true, width: 12 },
          { header: 'Code', key: 'purchase_code', width: 14 },
          { header: 'Receipt No', key: 'grn_no', width: 14 },
          { header: 'Product', key: 'product_name', width: 30 },
          { header: 'Supplier', key: 'supplier_name', width: 26 },
          { header: 'Quantity', key: 'quantity', width: 10 },
          { header: 'Unit Cost', key: 'unit_cost', money: true },
          { header: 'Total Cost', key: 'total_cost', money: true },
        ];
        await this.addSheet(wb, 'Stock IN', 'Stock IN Register', cols, rows, { totals: ['total_cost'] });
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Stock-IN-Register.xlsx' };
      }
      case 'stock-out': {
        const rows = await this.inventoryService.stockOut();
        const cols = [
          { header: 'Date', key: 'date', date: true, width: 12 },
          { header: 'Source', key: 'source', width: 10 },
          { header: 'Reference', key: 'ref_no', width: 14 },
          { header: 'Product', key: 'product_name', width: 30 },
          { header: 'Issued To', key: 'issued_to', width: 26 },
          { header: 'Purpose', key: 'purpose', width: 20 },
          { header: 'Quantity', key: 'quantity', width: 10 },
        ];
        await this.addSheet(wb, 'Stock Out', 'Stock Out Register', cols, rows);
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Stock-Out-Register.xlsx' };
      }
      case 'lookups': {
        const lk = await this.lookupsService.getLookups();
        const rows: any[] = [];
        for (const def of lk.lists) {
          const vals = lk.values[def.list] || [];
          for (const v of vals) {
            rows.push({
              list: def.list,
              title: def.title,
              value: v.value,
              label: v.label,
              locked: v.locked ? 'Yes' : 'No',
            });
          }
        }
        const cols = [
          { header: 'List Code', key: 'list', width: 16 },
          { header: 'List Title', key: 'title', width: 28 },
          { header: 'Value / Code', key: 'value', width: 16 },
          { header: 'Label', key: 'label', width: 34 },
          { header: 'Locked', key: 'locked', width: 10 },
        ];
        await this.addSheet(wb, 'Setting Lists', 'Dropdown Lists & Options (Setting)', cols, rows);
        return { buffer: await wb.xlsx.writeBuffer(), filename: 'Setting-Lists.xlsx' };
      }
      default:
        throw new NotFoundException('Unknown list export');
    }
  }

  public async buildReportExport(name: string, { fy, month }: any = {}, user?: any) {
    const wb = new ExcelJS.Workbook();
    const period = `FY ${fy}${month !== undefined && month !== '' ? ` · ${FY_MONTHS[+month]}` : ''}`;
    switch (name) {
      case 'monthly': {
        const r = await this.reportsService.monthlySummary(fy, user);
        const cols = [
          { header: 'Month', key: 'month', width: 12 },
          { header: 'Sales', key: 'sales', money: true },
          { header: 'Output VAT', key: 'output_vat', money: true },
          { header: 'Purchases', key: 'purchases', money: true },
          { header: 'Input VAT', key: 'input_vat', money: true },
          { header: 'Net VAT', key: 'net_vat', money: true },
        ];
        await this.addSheet(wb, 'Monthly Summary', `Monthly summary — ${fiscalYearLabel(fy)}`, cols, r.rows, { totals: ['sales', 'output_vat', 'purchases', 'input_vat', 'net_vat'] });
        break;
      }
      case 'products': {
        const rows = await this.reportsService.salesByProduct({ fy, month }, user);
        const cols = [
          { header: 'Code', key: 'code', width: 12 },
          { header: 'Product', key: 'name', width: 34 },
          { header: 'Qty Sold', key: 'qty', width: 9 },
          { header: 'Sales', key: 'sales', money: true },
          { header: 'Cost', key: 'cost', money: true },
          { header: 'Gross Profit', key: 'profit', money: true },
          { header: 'Margin %', key: 'margin', width: 9 },
        ];
        await this.addSheet(wb, 'Sales by Product', `Sales by product — ${period}`, cols, rows, { totals: ['qty', 'sales', 'cost', 'profit'] });
        break;
      }
      case 'suppliers': {
        const rows = await this.reportsService.partyTotals('P', { fy, month }, user);
        const cols = [
          { header: 'Supplier Name', key: 'name', width: 34 },
          { header: 'TIN', key: 'tin', width: 14 },
          { header: 'Receipts', key: 'count', width: 10 },
          { header: 'Taxable Amount', key: 'taxable', money: true },
          { header: 'VAT Amount', key: 'vat', money: true },
          { header: 'Total after VAT', key: 'total', money: true },
          { header: 'Withholding', key: 'wh', money: true },
          { header: 'Outstanding Balance', key: 'balance', money: true },
        ];
        await this.addSheet(wb, 'Suppliers', `Purchases by Supplier — ${period}`, cols, rows, {
          totals: ['count', 'taxable', 'vat', 'total', 'wh', 'balance'],
        });
        break;
      }
      case 'customers': {
        const rows = await this.reportsService.partyTotals('S', { fy, month }, user);
        const cols = [
          { header: 'Customer Name', key: 'name', width: 34 },
          { header: 'TIN', key: 'tin', width: 14 },
          { header: 'Invoices', key: 'count', width: 10 },
          { header: 'Taxable Amount', key: 'taxable', money: true },
          { header: 'VAT Amount', key: 'vat', money: true },
          { header: 'Total after VAT', key: 'total', money: true },
          { header: 'Withholding', key: 'wh', money: true },
          { header: 'Outstanding Balance', key: 'balance', money: true },
        ];
        await this.addSheet(wb, 'Customers', `Sales by Customer — ${period}`, cols, rows, {
          totals: ['count', 'taxable', 'vat', 'total', 'wh', 'balance'],
        });
        break;
      }
      default:
        throw new NotFoundException('Unknown report');
    }
    return {
      buffer: await wb.xlsx.writeBuffer(),
      filename: `Report-${name}-FY${fy}.xlsx`,
    };
  }
}
