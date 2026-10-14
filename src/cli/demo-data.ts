// Demonstration data for every page (purchases, sales, withholding, credit, stock, VAT, reports).
//
//   npm run demo            load the demo data
//   npm run demo:remove     remove everything the demo added and restore changed products
//
// Everything created is tracked in the demo_records table, so removal is exact.
import { withAppContext } from './context.js';
import { DataSource } from '../orm/data-source.js';
import { InvoicesService } from '../modules/invoices/invoices.service.js';
import { round2 } from '../common/lib/calc.js';

withAppContext(async (app) => {
  const ds = app.get(DataSource);
  const invoices = app.get(InvoicesService);
  const db = ds.getDatabase();
  const transaction = <T>(fn: () => T) => ds.transaction(fn);
  const saveInvoice = (kind: 'P' | 'S', input: any) => invoices.saveInvoice(kind, input, null, 'admin');
  const updateWithholding = (id: number, input: any) => invoices.updateWithholding(id, input);
  const addPayment = (id: number, input: any) => invoices.addPayment(id, input);
  const getInvoice = (id: number) => invoices.getInvoice(id);

  db.exec('PRAGMA busy_timeout = 8000');
  db.exec('CREATE TABLE IF NOT EXISTS demo_records (entity TEXT NOT NULL, ref TEXT NOT NULL, restore TEXT)');
  const track = (entity: string, ref: any, restore: any = null) => db.prepare('INSERT INTO demo_records (entity, ref, restore) VALUES (?,?,?)')
    .run(entity, String(ref), restore ? JSON.stringify(restore) : null);

  // ---------------------------------------------------------------------------
  if (process.argv.includes('--remove')) {
    const rows = db.prepare('SELECT * FROM demo_records').all() as any[];
    if (!rows.length) { console.log('No demo data to remove.'); return; }
    transaction(() => {
      for (const r of rows.filter((x) => x.entity === 'invoice')) db.prepare('DELETE FROM invoices WHERE id = ?').run(+r.ref);
      for (const r of rows.filter((x) => x.entity === 'issue')) db.prepare('DELETE FROM stock_issues WHERE id = ?').run(+r.ref);
      for (const r of rows.filter((x) => x.entity === 'party')) db.prepare('DELETE FROM parties WHERE id = ?').run(+r.ref);
      for (const r of rows.filter((x) => x.entity === 'audit')) db.prepare('DELETE FROM audit_log WHERE id = ?').run(+r.ref);
      for (const r of rows.filter((x) => x.entity === 'product')) {
        const o = JSON.parse(r.restore as string);
        db.prepare(`UPDATE products SET category = ?, brand = ?, purchase_price = ?, selling_price = ?, opening_stock = ?, min_stock = ?
          WHERE code = ?`).run(o.category, o.brand, o.purchase_price, o.selling_price, o.opening_stock, o.min_stock, r.ref);
      }
      db.exec('DELETE FROM demo_records');
    });
    console.log(`Removed demo data (${rows.length} tracked records). Your own data is unchanged.`);
    return;
  }

  if ((db.prepare('SELECT COUNT(*) AS n FROM demo_records').get() as any).n) {
    console.log('Demo data is already loaded. Run "npm run demo:remove" first to reload it.');
    return;
  }

  // ---------------------------------------------------------------------------
  // Products: prices, categories and stock levels for the items used below
  // ---------------------------------------------------------------------------
  const PRODUCTS: Record<string, [string, string, number, number, number, number]> = {
    NEX00001: ['Networking', 'TP-Link', 4200, 5600, 0, 4],
    NEX00002: ['Networking', 'TP-Link', 3800, 5100, 0, 4],
    NEX00003: ['Accessories', 'Logitech', 650, 1100, 0, 10],
    NEX00004: ['Accessories', 'Logitech', 420, 780, 0, 15],
    NEX00005: ['Storage', 'SanDisk', 3200, 4500, 0, 5],
    NEX00007: ['Computers', 'Samsung', 15500, 24000, 0, 4],
    NEX00010: ['Computers', 'HP', 52500, 69000, 0, 5],
    NEX00016: ['Computers', 'Dell', 14500, 20000, 0, 8],
    NEX00017: ['Storage', 'Samsung', 6200, 8300, 0, 5],
    NEX00020: ['Printing & Toner', 'HP', 2900, 4250, 0, 10],
    NEX00026: ['Power', 'Intex', 18500, 24500, 6, 3],
    NEX00027: ['Computers', 'Dell', 55000, 72000, 4, 2],
    NEX00029: ['Computers', 'Lenovo', 38000, 49000, 0, 6],
    NEX00033: ['Storage', 'Samsung', 4100, 5700, 0, 5],
  };

  // ---------------------------------------------------------------------------
  // Suppliers & customers (fictional)
  // ---------------------------------------------------------------------------
  const PARTIES: [string, string, string, string | null, string, string][] = [
    ['0045217890', 'Habesha Computer Trading PLC', 'Supplier', 'MRC-HCT-01', '0911 234 567', 'Merkato, Addis Ababa'],
    ['0061234508', 'Abay Networking PLC', 'Supplier', 'MRC-ABN-07', '0912 445 120', 'Kazanchis, Addis Ababa'],
    ['0038890451', 'Ethio Electronics Import S.C.', 'Supplier', 'MRC-EEI-02', '0115 530 210', 'Bole Road, Addis Ababa'],
    ['0072001946', 'Bole Property Rentals PLC', 'Supplier', 'MRC-BPR-11', '0116 617 700', 'Bole, Addis Ababa'],
    ['0029934177', 'Selam Office Supplies', 'Supplier', 'MRC-SOS-03', '0913 220 904', 'Piassa, Addis Ababa'],
    ['0050127733', 'Lalibela Consulting PLC', 'Supplier', null, '0911 908 112', 'CMC, Addis Ababa'],
    ['0068811402', 'Tana Fuel Station', 'Supplier', 'MRC-TFS-05', '0918 330 441', 'Megenagna, Addis Ababa'],
    ['0057730026', 'Addis Tech Solutions PLC', 'Supplier', 'MRC-ATS-09', '0912 667 018', 'Sarbet, Addis Ababa'],
    ['0011458823', 'Abyssinia Traders PLC', 'Customer', 'MRC-ABT-04', '0911 556 301', 'Hayahulet, Addis Ababa'],
    ['0034409915', 'Entoto Engineering PLC', 'Customer', null, '0116 450 880', 'Gulele, Addis Ababa'],
    ['0076620148', 'Meskel Square Hotel', 'Customer', 'MRC-MSH-02', '0115 158 900', 'Meskel Square, Addis Ababa'],
    ['0042287760', 'Rift Valley College', 'Customer', null, '0462 205 117', 'Hawassa'],
    ['0063341257', 'Sheba Pharmaceuticals PLC', 'Customer', 'MRC-SHP-01', '0114 403 662', 'Akaki, Addis Ababa'],
    ['0025517349', 'Awash Logistics S.C.', 'Customer', 'MRC-AWL-03', '0221 110 245', 'Adama'],
  ];

  // line helper: [code or null, description, qty, unit price, input category / sales type, extra]
  const L = (code: string | null, description: string, qty: number, unit_price: number, tx_type: number, extra: any = {}) => ({
    product_code: code || '', description, qty, unit_price, tx_type, unit: extra.unit ?? 7,
    transaction_type: extra.tt || 'Vatable', excise_rate: extra.excise || 0,
    vatable_service_fee: extra.fee || 0, non_vatable_fee: extra.other || 0,
  });

  const tin = (name: string) => PARTIES.find((p) => p[1] === name)?.[0]
    || (db.prepare('SELECT tin FROM parties WHERE name = ?').get(name) as any)?.tin || '';
  let fs = 0; let m = 0;
  const FS = () => `FS${String(48100 + (fs += 7)).padStart(8, '0')}`;
  const M = () => `M-${String(2200 + (m += 3)).padStart(5, '0')}`;

  // [date, party, payment, product type, receipt, lines, options]
  type Row = [string, string | null, string, string, string, ReturnType<typeof L>[], any];
  const PURCHASES: Row[] = [
    ['2026-05-20', 'Habesha Computer Trading PLC', 'Credit', 'G', 'MRC', [L('NEX00010', 'Laptop Core i5 (13th Gen)', 10, 52500, 3)], { wh: 'same', pay: 'full', status: 'Reported' }],
    ['2026-06-15', 'Ethio Electronics Import S.C.', 'Cash', 'G', 'Manual', [L('NEX00016', 'Dell Monitor 24"', 15, 14500, 4)], { wh: 'same', status: 'Reported' }],
    ['2026-06-25', 'Bole Property Rentals PLC', 'Cash', 'S', 'MRC', [L('NEX000A1', 'Office rent – Sene', 1, 85000, 5, { unit: 9 })], { wh: 'same', status: 'Reported' }],
    ['2026-07-10', 'Habesha Computer Trading PLC', 'Credit', 'G', 'MRC', [L('NEX00010', 'Laptop Core i5 (13th Gen)', 8, 53000, 3), L('NEX00004', 'Mouse', 40, 420, 3)], { wh: 'late', pay: 'twice', status: 'Reported' }],
    ['2026-07-15', 'Abay Networking PLC', 'Cash', 'G', 'MRC', [L('NEX00001', 'TP-LINK MR6400', 20, 4200, 3), L('NEX00002', 'TP-LINK AC 1200', 15, 3800, 3)], { wh: 'same', status: 'Reported' }],
    ['2026-07-22', 'Ethioptelecom', 'Cash', 'S', 'MRC', [L('NEX000A2', 'Internet & telephone – Hamle', 1, 12500, 5, { unit: 9 })], { status: 'Reported' }],
    ['2026-07-28', 'Bole Property Rentals PLC', 'Credit', 'S', 'MRC', [L('NEX000A1', 'Office rent – Hamle', 1, 85000, 5, { unit: 9 })], { wh: 'same', pay: 'full', status: 'Reported' }],
    ['2026-08-02', 'Tana Fuel Station', 'Cash', 'G', 'MRC', [L('NEX000A4', 'Fuel for delivery vehicle', 1, 6000, 5, { unit: 5 })], { status: 'Reported' }],
    ['2026-08-10', 'Ethio Electronics Import S.C.', 'Credit', 'G', 'Manual', [L(null, 'HP Desktop Core i7 – office use', 5, 61000, 2)], { wh: 'same', pay: 'full', status: 'Reported' }],
    ['2026-08-14', 'Selam Office Supplies', 'Cash', 'G', 'Manual', [L('NEX000A3', 'Office supplies and stationery', 1, 4800, 5, { unit: 9 })], { status: 'Reported' }],
    ['2026-08-18', 'Habesha Computer Trading PLC', 'Credit', 'G', 'MRC', [
      L('NEX00017', '2TB SSD', 25, 6200, 3, { fee: 1500 }), L('NEX00033', '1TB SSD', 30, 4100, 3), L('NEX00020', 'Toner HP 80A', 40, 2900, 3, { other: 300 })],
    { wh: 'same', pay: 'part', status: 'Reported' }],
    ['2026-08-25', 'Lalibela Consulting PLC', 'Credit', 'S', 'Manual', [L('NEX000A8', 'Audit & tax advisory fee', 1, 35000, 5, { unit: 9 })], { wh: 'pending', status: 'Reported' }],
    ['2026-08-28', null, 'Cash', 'G', 'Manual', [L(null, 'Cleaning materials (seller without VAT)', 1, 3200, 6, { unit: 9, tt: 'Non-Vatable' })], { status: 'Reported', name: 'Merkato small trader' }],
    ['2026-09-05', 'Ethio Electronics Import S.C.', 'Credit', 'G', 'MRC', [L(null, 'Standby generator 20 kVA – office', 1, 145000, 1)], { wh: 'same', pay: 'full' }],
    ['2026-09-12', 'Habesha Computer Trading PLC', 'Credit', 'G', 'MRC', [L('NEX00029', 'Lenovo Thinkpad Core i7 8th 16/1', 12, 38000, 3)], { wh: 'pending' }],
    ['2026-09-16', 'Abay Networking PLC', 'Cash', 'G', 'MRC', [L('NEX00003', 'Keyboard', 50, 650, 3), L('NEX00004', 'Mouse', 60, 420, 3)], { wh: 'same' }],
    ['2026-09-20', null, 'Cash', 'G', 'Manual', [L(null, 'Used delivery motorbike (private seller)', 1, 95000, 7, { unit: 9, tt: 'Non-Vatable' })], { name: 'Private seller – Kebede A.' }],
    ['2026-09-24', 'Ethioptelecom', 'Cash', 'S', 'MRC', [L('NEX000A2', 'Internet & telephone – Meskerem', 1, 13800, 5, { unit: 9 })], {}],
    ['2026-09-27', 'Bole Property Rentals PLC', 'Credit', 'S', 'MRC', [L('NEX000A1', 'Office rent – Meskerem', 1, 85000, 5, { unit: 9 })], { wh: 'same' }],
    ['2026-09-30', 'Addis Tech Solutions PLC', 'Credit', 'S', 'MRC', [L('NEX000A13', 'Accounting software subscription (1 year)', 1, 22000, 5, { unit: 9 })], { wh: 'pending' }],
    ['2026-10-01', 'Ethio Electronics Import S.C.', 'Credit', 'G', 'Manual', [L('NEX00007', 'Tab A9', 20, 15500, 4, { excise: 10 })], { wh: 'pending' }],
    ['2026-10-02', 'Abay Networking PLC', 'Cash', 'G', 'MRC', [L('NEX00005', 'Sandisk 1TB', 30, 3200, 3)], { wh: 'same' }],
  ];

  const SALES: Row[] = [
    ['2026-06-02', 'Abyssinia Traders PLC', 'Credit', 'G', 'MRC', [L('NEX00010', 'Laptop Core i5 (13th Gen)', 4, 68000, 1)], { wh: 'same', pay: 'full', status: 'Reported' }],
    ['2026-06-28', 'Entoto Engineering PLC', 'Cash', 'G', 'MRC', [L('NEX00016', 'Dell Monitor 24"', 5, 19500, 1)], { wh: 'same', status: 'Reported' }],
    ['2026-07-14', 'Meskel Square Hotel', 'Credit', 'G', 'MRC', [L('NEX00010', 'Laptop Core i5 (13th Gen)', 3, 69000, 1), L('NEX00004', 'Mouse', 6, 800, 1)], { wh: 'same', pay: 'part', status: 'Reported' }],
    ['2026-07-20', null, 'Cash', 'G', 'MRC', [L('NEX00004', 'Mouse', 10, 750, 1)], { status: 'Reported', name: 'Walk-in customer' }],
    ['2026-07-25', 'Rift Valley College', 'Credit', 'G', 'Manual', [L('NEX00001', 'TP-LINK MR6400', 10, 5600, 1), L('NEX00002', 'TP-LINK AC 1200', 6, 5100, 1)], { wh: 'same', pay: 'full', status: 'Reported' }],
    ['2026-08-04', 'Sheba Pharmaceuticals PLC', 'Cash', 'G', 'MRC', [L('NEX00010', 'Laptop Core i5 (13th Gen)', 2, 70000, 1)], { wh: 'same', status: 'Reported' }],
    ['2026-08-12', null, 'Credit', 'G', 'Manual', [L('NEX00016', 'Dell Monitor 24" (export)', 4, 21000, 2, { tt: 'Zero Rated' })], { pay: 'full', status: 'Reported', name: 'Djibouti Tech FZE (export)' }],
    ['2026-08-20', 'Abyssinia Traders PLC', 'Credit', 'G', 'MRC', [L('NEX00017', '2TB SSD', 10, 8200, 1), L('NEX00033', '1TB SSD', 12, 5600, 1), L('NEX00020', 'Toner HP 80A', 15, 4200, 1)], { wh: 'same', pay: 'part', status: 'Reported' }],
    ['2026-08-26', 'Entoto Engineering PLC', 'Cash', 'G', 'MRC', [L('NEX00020', 'Toner HP 80A', 13, 4300, 1)], { wh: 'same', status: 'Reported' }],
    ['2026-09-02', null, 'Cash', 'G', 'MRC', [L('NEX00004', 'Mouse', 15, 750, 1)], { status: 'Reported', name: 'Walk-in customer' }],
    ['2026-09-08', 'Rift Valley College', 'Credit', 'S', 'Manual', [L(null, 'Computer skills training – 40 students', 1, 45000, 3, { unit: 9, tt: 'Tax Exempt' })], { pay: 'full', status: 'Reported' }],
    ['2026-09-10', 'Meskel Square Hotel', 'Credit', 'G', 'MRC', [L('NEX00001', 'TP-LINK MR6400', 4, 5600, 1), L('NEX00002', 'TP-LINK AC 1200', 3, 5100, 1)], { pay: 'full', status: 'Reported' }],
    ['2026-09-14', 'Meskel Square Hotel', 'Credit', 'G', 'MRC', [L('NEX00026', 'Intex UPS 1500VA', 4, 24500, 1)], { wh: 'same' }],
    ['2026-09-18', 'Sheba Pharmaceuticals PLC', 'Credit', 'G', 'MRC', [L('NEX00029', 'Lenovo Thinkpad Core i7 8th 16/1', 7, 49000, 1), L('NEX00017', '2TB SSD', 8, 8300, 1)], { wh: 'same', pay: 'part' }],
    ['2026-09-22', 'Awash Logistics S.C.', 'Cash', 'G', 'MRC', [L('NEX00003', 'Keyboard', 30, 1100, 1), L('NEX00004', 'Mouse', 24, 780, 1)], { wh: 'same' }],
    ['2026-09-25', 'Entoto Engineering PLC', 'Credit', 'G', 'MRC', [L('NEX00027', 'Dell Optiplex 7020 i5', 3, 72000, 1)], { wh: 'same' }],
    ['2026-09-29', 'Abyssinia Traders PLC', 'Credit', 'G', 'MRC', [L('NEX00010', 'Laptop Core i5 (13th Gen)', 3, 70000, 1), L('NEX00033', '1TB SSD', 8, 5700, 1)], { wh: 'same' }],
    ['2026-10-02', null, 'Cash', 'G', 'MRC', [L('NEX00005', 'Sandisk 1TB', 10, 4500, 1)], { name: 'Walk-in customer' }],
    ['2026-10-02', 'Rift Valley College', 'Credit', 'G', 'Manual', [L('NEX00007', 'Tab A9', 6, 24000, 1)], { wh: 'same' }],
  ];

  const ISSUES: [string, string, number, string, string, string][] = [
    ['2026-07-30', 'NEX00004', 3, 'Administration', 'Replacement mice for front office', 'Store manager'],
    ['2026-08-30', 'NEX00020', 2, 'Finance', 'Printer toner for finance printer', 'Finance head'],
    ['2026-09-18', 'NEX00003', 2, 'IT', 'Spare keyboards for help desk', 'IT manager'],
    ['2026-09-21', 'NEX00010', 1, 'Sales', 'Laptop for new sales officer', 'General manager'],
  ];

  // ---------------------------------------------------------------------------
  const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const min = (a: string, b: string) => (a < b ? a : b);
  const TODAY = '2026-10-03';
  let whNo = 0;

  async function load(kind: 'P' | 'S', rows: Row[]) {
    const out: any[] = [];
    for (const [date, partyName, payment, cat, receipt, lines, o] of rows) {
      const inv: any = await saveInvoice(kind, {
        payment_type: payment, vat_category: cat, calendar_type: 'G', date, receipt_type: receipt,
        party_tin: partyName ? tin(partyName) : '', party_name: partyName || o.name || '',
        mrc_number: receipt === 'MRC' ? (PARTIES.find((p) => p[1] === partyName)?.[3] || 'MRC-GEN-01') : '',
        vat_receipt_no: receipt === 'MRC' ? FS() : M(),
        report_status: o.status || 'Not Reported', notes: o.note || '', lines,
      });
      db.prepare("UPDATE invoices SET created_by = 'admin', updated_by = 'admin', created_at = ? WHERE id = ?").run(`${date} 09:30:00`, inv.id);
      track('invoice', inv.id);
      const a = db.prepare('INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, summary) VALUES (?,?,?,?,?,?,?)')
        .run(`${date} 09:30:00`, 1, 'admin', 'create', kind === 'P' ? 'purchase' : 'sale', inv.id,
          `${kind === 'P' ? 'Purchase' : 'Sale'} ${inv.invoice_no} created – ${inv.party_name || 'no party'}, total ${inv.grand_total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      track('audit', a.lastInsertRowid);

      // Withholding
      let cur: any = inv;
      if (cur.wh.applicable && o.wh) {
        whNo += 1;
        const expected = round2(cur.wh.base * 0.03);
        const whDate = o.wh === 'late' ? addDays(date, 32) : min(addDays(date, 5), TODAY);
        cur = await updateWithholding(cur.id, o.wh === 'pending'
          ? { wh_receipt_type: 'With Receipt', wh_paid: 0 }
          : { wh_receipt_type: 'With Receipt', wh_receipt_no: `WH-${String(1000 + whNo)}`, wh_receipt_date: whDate, wh_paid: expected });
      }
      // Payments on credit transactions
      if (payment === 'Credit' && o.pay) {
        const method = kind === 'P' ? 'Bank transfer' : 'Cheque';
        if (o.pay === 'full') await addPayment(cur.id, { date: min(addDays(date, 12), TODAY), amount: cur.balance, method, reference: `REF-${cur.invoice_no}` });
        if (o.pay === 'part') await addPayment(cur.id, { date: min(addDays(date, 10), TODAY), amount: round2(cur.balance * 0.5), method, reference: `REF-${cur.invoice_no}-1` });
        if (o.pay === 'twice') {
          await addPayment(cur.id, { date: addDays(date, 15), amount: 300000, method, reference: `REF-${cur.invoice_no}-1` });
          const after: any = await getInvoice(cur.id);
          await addPayment(cur.id, { date: addDays(date, 40), amount: after.balance, method, reference: `REF-${cur.invoice_no}-2` });
        }
      }
      out.push(await getInvoice(cur.id));
    }
    return out;
  }

  transaction(() => {
    for (const [code, [category, brand, cost, price, opening, minStock]] of Object.entries(PRODUCTS)) {
      const old: any = db.prepare('SELECT category, brand, purchase_price, selling_price, opening_stock, min_stock FROM products WHERE code = ?').get(code);
      if (!old) throw new Error(`Product ${code} not found`);
      track('product', code, old);
      db.prepare('UPDATE products SET category = COALESCE(category, ?), brand = COALESCE(brand, ?), purchase_price = ?, selling_price = ?, opening_stock = ?, min_stock = ? WHERE code = ?')
        .run(category, brand, cost, price, opening, minStock, code);
    }
    for (const [t, name, type, mrc, phone, address] of PARTIES) {
      const existing = db.prepare('SELECT id FROM parties WHERE tin = ?').get(t);
      if (existing) continue;
      const r = db.prepare('INSERT INTO parties (tin, name, type, mrc1, phone, address) VALUES (?,?,?,?,?,?)').run(t, name, type, mrc, phone, address);
      track('party', r.lastInsertRowid);
    }
  });

  {
    // Interleave purchases, sales and issues by date so stock never goes negative.
    const events: { date: string; order: number; run: () => unknown }[] = [
      ...PURCHASES.map((r) => ({ date: r[0], order: 0, run: () => load('P', [r]) })),
      ...SALES.map((r) => ({ date: r[0], order: 1, run: () => load('S', [r]) })),
      ...ISSUES.map(([date, code, qty, department, purpose, approved]) => ({
        date, order: 2,
        run: () => {
          const p = db.prepare('SELECT id FROM products WHERE code = ?').get(code) as any;
          const n = (db.prepare('SELECT COUNT(*) AS n FROM stock_issues').get() as any).n;
          const r = db.prepare('INSERT INTO stock_issues (issue_no, date, product_id, qty, department, purpose, approved_by) VALUES (?,?,?,?,?,?,?)')
            .run(`ISS${String(n + 1).padStart(4, '0')}`, date, p.id, qty, department, purpose, approved);
          track('issue', r.lastInsertRowid);
        },
      })),
    ].sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
    for (const e of events) await e.run();

    const a = db.prepare("INSERT INTO audit_log (user_id, username, action, entity, summary) VALUES (1, 'admin', 'other', 'setting', 'Demo data loaded')").run();
    track('audit', a.lastInsertRowid);
  }

  // Check stock never went negative
  const negative = db.prepare(`SELECT p.code, p.opening_stock
    + COALESCE((SELECT SUM(l.qty) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.product_id = p.id AND i.kind = 'P'), 0)
    - COALESCE((SELECT SUM(l.qty) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.product_id = p.id AND i.kind = 'S'), 0)
    - COALESCE((SELECT SUM(s.qty) FROM stock_issues s WHERE s.product_id = p.id), 0) AS stock
    FROM products p WHERE p.track_stock = 1`).all().filter((r: any) => r.stock < 0);
  if (negative.length) console.warn('Warning: negative stock for', negative);

  const count = (k: string) => (db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE kind = ?').get(k) as any).n;
  console.log(`Demo data loaded: ${count('P')} purchases, ${count('S')} sales, ${PARTIES.length} companies, ${ISSUES.length} stock issues.`);
  console.log('Remove it any time with: npm run demo:remove');
}).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
