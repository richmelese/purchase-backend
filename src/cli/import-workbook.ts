// Imports master data (products, suppliers) and any purchase / sales rows
// from the original "All In One Sales.xlsx" workbook.
//
//   npm run import -- "C:\Users\HP\Documents\All In One Sales.xlsx"
//
// Safe to run more than once: existing product codes and TINs are updated,
// transactions whose number already exists are skipped.
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { withAppContext } from './context.js';
import { DataSource } from '../orm/data-source.js';
import { InvoicesService } from '../modules/invoices/invoices.service.js';
import { ImportExportService } from '../modules/import-export/import-export.service.js';
import { UNITS } from '../common/lib/calc.js';

// Relative paths are taken from where npm was run (INIT_CWD), not from purchase-backend/.
const file = process.argv[2]
  ? path.resolve(process.env.INIT_CWD || process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', '..', '..', '..', 'All In One Sales.xlsx');

const val = (cell: any) => {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((t: any) => t.text).join('');
    else if (v.text) v = v.text;
  }
  if (typeof v === 'string') {
    v = v.trim();
    if (/^select /i.test(v) || v === 'No Data') return null;
  }
  return v ?? null;
};
const text = (c: any) => { const v = val(c); return v == null ? '' : String(v).trim(); };
const numOr = (c: any, d = 0) => { const n = Number(val(c)); return Number.isFinite(n) ? n : d; };
const unitId = (v: any) => {
  if (v == null || v === '') return 7;
  if (Number.isFinite(+v)) return +v;
  return (UNITS.find((u) => u.label.toLowerCase() === String(v).toLowerCase()) || { value: 7 }).value;
};
const isoDate = (v: any) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || ''));
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};

withAppContext(async (app) => {
  const db = app.get(DataSource);
  const invoices = app.get(InvoicesService);
  const importer = app.get(ImportExportService);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  console.log(`Reading ${file}`);

  // ---- products & suppliers ---------------------------------------------
  const p0 = await importer.importProducts(file);
  console.log(`  products:  ${p0.added} added, ${p0.updated} updated, ${p0.skipped} skipped (sheet "${p0.sheet}")`);
  const s0 = await importer.importParties(file, 'Supplier');
  console.log(`  suppliers: ${s0.added} added, ${s0.updated} updated, ${s0.skipped} skipped (sheet "${s0.sheet}")`);

  // ---- transactions (P. Detail / S. Detail) --------------------------------
  async function importDetail(sheetName: string, kind: 'P' | 'S') {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return { imported: 0, skipped: 0, failed: 0 };
    const groups = new Map<string, any>();
    ws.eachRow((row, i) => {
      if (i < 4) return;
      const code = text(row.getCell('B'));
      if (!code) return;
      if (!groups.has(code)) {
        groups.set(code, {
          invoice_no: code,
          payment_type: text(row.getCell('C')) || 'Cash',
          vat_category: text(row.getCell('D')) || 'G',
          calendar_type: text(row.getCell('E')) || 'G',
          party_tin: text(row.getCell('F')),
          party_name: text(row.getCell('G')),
          date: isoDate(val(row.getCell('H'))),
          receipt_type: text(row.getCell('J')) || 'Manual',
          mrc_number: text(row.getCell('K')),
          vat_receipt_no: text(row.getCell('L')) || code,
          report_status: text(row.getCell('AB')) === 'Reported' ? 'Reported' : 'Not Reported',
          lines: [],
        });
      }
      groups.get(code).lines.push({
        product_code: text(row.getCell('M')),
        description: text(row.getCell('N')) || text(row.getCell('M')) || 'Item',
        unit: unitId(val(row.getCell('O'))),
        tx_type: numOr(row.getCell('P'), kind === 'S' ? 1 : 3),
        transaction_type: text(row.getCell('X')) || 'Vatable',
        qty: numOr(row.getCell('Q'), 1),
        unit_price: numOr(row.getCell('R')),
        excise_rate: (() => { const r = numOr(row.getCell('T')); return r > 0 && r < 1 ? r * 100 : r; })(),
        vatable_service_fee: numOr(row.getCell('V')),
        non_vatable_fee: numOr(row.getCell('Z')),
      });
    });
    let imported = 0; let skipped = 0; let failed = 0;
    for (const inv of groups.values()) {
      if (db.queryOne('SELECT 1 FROM invoices WHERE invoice_no = ?', [inv.invoice_no])) { skipped++; continue; }
      try { await invoices.saveInvoice(kind, inv); imported++; } catch (e: any) {
        failed++;
        const fields = e.getResponse?.()?.fields;
        console.warn(`  ! ${sheetName} ${inv.invoice_no}: ${e.message}${fields ? ' ' + JSON.stringify(fields) : ''}`);
      }
    }
    return { imported, skipped, failed };
  }
  const p = await importDetail('P. Detail', 'P');
  const s = await importDetail('S. Detail', 'S');
  console.log(`  purchases: ${p.imported} imported, ${p.skipped} already present, ${p.failed} failed`);
  console.log(`  sales:     ${s.imported} imported, ${s.skipped} already present, ${s.failed} failed`);
  console.log('Done.');
}).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
