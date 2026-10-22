// Regression tests for frontend ↔ API contracts: each test drives an endpoint exactly the way a page
// in the Next.js app calls it and checks the fields that page reads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 6000 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SECRET = 'contracts-bff-secret';
let server; let dir; let admin = '';

const call = async (method, url, body, { cookie = admin, raw } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'x-bff-secret': SECRET,
      ...(cookie ? { cookie } : {}),
      ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
};

const login = async (username, password) => {
  const r = await call('POST', '/auth/login', { username, password }, { cookie: '' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.headers.get('set-cookie').split(';')[0];
};

const header = (over = {}) => ({
  payment_type: 'Cash', vat_category: 'G', calendar_type: 'G', party_tin: '0000030603', party_name: 'Ethio telecom',
  date: '2026-09-15', receipt_type: 'MRC', mrc_number: 'ABC123', vat_receipt_no: 'FS0001', ...over,
});
const line = (qty, unit_price, tx_type, code = 'GEN') => ({ product_code: code, description: 'Generator', unit: 7, tx_type, transaction_type: 'Vatable', qty, unit_price });

const xlsx = async (sheet, rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-contracts-'));
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATABASE_PATH: path.join(dir, 'psm.db'), BFF_SHARED_SECRET: SECRET, CORS_ORIGIN: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let up = false;
  for (let i = 0; i < 300 && !up; i++) { // cold starts can take well over 10 s on Windows
    try { up = (await fetch(`${BASE}/health`)).ok; } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) throw new Error('server did not start');
  await call('POST', '/auth/signup', { username: 'admin', full_name: 'Admin', password: 'Admin-pass-1' }, { cookie: '' });
  admin = await login('admin', 'Admin-pass-1');
  assert.equal((await call('POST', '/products', { code: 'GEN', name_en: 'Generator', unit: 7, track_stock: 1, opening_stock: 50 })).status, 201);
});

after(() => {
  server?.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('signed-up users get a real role: the admin can edit their own account, activated users have permissions', async () => {
  // Settings › Users always sends role_id with the form; saving your own name must not count as a role change.
  const users = (await call('GET', '/users')).data;
  const me = users.find((u) => u.username === 'admin');
  assert.ok(me.role_id, 'first administrator has a role id');
  const self = await call('PUT', `/users/${me.id}`, { full_name: 'Admin Renamed', role_id: me.role_id, access_all_parties: true });
  assert.equal(self.status, 200, JSON.stringify(self.data));

  // A later sign-up waits for approval; once activated it has the viewer role's permissions.
  await call('POST', '/auth/signup', { username: 'newbie', full_name: 'New User', password: 'Newbie-pass-1' }, { cookie: '' });
  const pending = (await call('GET', '/users')).data.find((u) => u.username === 'newbie');
  const viewer = (await call('GET', '/roles')).data.find((r) => r.name === 'viewer');
  assert.equal(pending.role_id, viewer.id);
  assert.equal((await call('PUT', `/users/${pending.id}`, { active: true })).status, 200);
  const newbie = await login('newbie', 'Newbie-pass-1');
  assert.equal((await call('GET', '/products', undefined, { cookie: newbie })).status, 200);
});

test('a product can be deleted unless it is used on an invoice', async () => {
  const p = (await call('POST', '/products', { code: 'TMP', name_en: 'Temporary', unit: 7 })).data;
  const del = await call('DELETE', `/products/${p.id}`);
  assert.ok(del.status === 200 || del.status === 204, `delete failed: ${del.status}`);

  const used = (await call('GET', '/products')).data.find((x) => x.code === 'GEN');
  await call('POST', '/sales', { ...header({ vat_receipt_no: 'FS7001' }), lines: [line(1, 100, 1)] });
  const blocked = await call('DELETE', `/products/${used.id}`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /cannot be deleted/);
});

test('async transactions commit only after the callback finishes and roll back when it fails', async () => {
  // Invoice saves and sign-up await repository calls inside a transaction.
  const { DataSource } = await import(pathToFileURL(path.join(ROOT, 'dist', 'orm', 'data-source.js')).href);
  const ds = new DataSource({ databasePath: path.join(dir, 'tx.db') }).initialize();
  ds.exec('CREATE TABLE IF NOT EXISTS t (v TEXT)');

  await assert.rejects(ds.transactionAsync(async () => {
    ds.execute('INSERT INTO t (v) VALUES (?)', ['before await']);
    await Promise.resolve();
    ds.execute('INSERT INTO t (v) VALUES (?)', ['after await']);
    throw new Error('boom');
  }), /boom/);
  assert.equal(ds.queryOne('SELECT COUNT(*) AS n FROM t').n, 0, 'both inserts rolled back');

  const results = await Promise.all([1, 2].map((n) => ds.transactionAsync(async () => {
    await Promise.resolve();
    ds.execute('INSERT INTO t (v) VALUES (?)', [String(n)]);
    return n;
  })));
  assert.deepEqual(results, [1, 2]);
  assert.equal(ds.queryOne('SELECT COUNT(*) AS n FROM t').n, 2, 'queued transactions both committed');
});

test('re-importing an exported product list keeps unit, minimum stock and stock tracking', async () => {
  await call('POST', '/products', { code: 'SRV', name_en: 'Installation', unit: 3, track_stock: 0, min_stock: 4, purchase_price: 10, selling_price: 20 });
  // The product export has no Unit / Minimum Stock / Track Stock columns, and ends with a totals row.
  const file = await xlsx('Product Lists', [['Product Code', 'Product English Name'], ['SRV', 'Installation service'], ['TOTAL', '']]);
  const res = await call('POST', '/import/products', undefined, { raw: file });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.updated, 1);
  assert.equal(res.data.skipped, 0);
  const srv = (await call('GET', '/products')).data.find((p) => p.code === 'SRV');
  assert.equal(srv.name_en, 'Installation service');
  assert.equal(srv.unit, 3);
  assert.equal(srv.track_stock, 0);
  assert.equal(srv.min_stock, 4);
  assert.equal(srv.selling_price, 20);
});

test('re-importing the supplier list keeps an existing customer a customer', async () => {
  await call('POST', '/parties', { tin: '0044444444', name: 'Loyal Customer PLC', type: 'Customer', create_login: false });
  const file = await xlsx('Supplier Lists', [['Company Name', 'Company TIN', 'Phone No'], ['Loyal Customer PLC', '0044444444', '0911000000']]);
  const res = await call('POST', '/import/parties?type=Supplier', undefined, { raw: file });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const p = (await call('GET', '/parties?type=Customer')).data.find((x) => x.tin === '0044444444');
  assert.ok(p, 'still listed as a customer');
  assert.equal(p.phone, '0911000000');
});

test('company form: an invalid e-mail is reported on the profile field only', async () => {
  const tpl = (await call('GET', '/parties/profile-template')).data;
  const profile = structuredClone(tpl.profile ?? tpl);
  profile.address = { ...(profile.address || {}), email: 'not-an-email' };
  const res = await call('POST', '/parties', { tin: '0033333333', name: 'Bad Mail PLC', type: 'Supplier', profile });
  assert.equal(res.status, 400);
  assert.ok(res.data.fields['profile.address.email']);
  assert.equal(res.data.fields.email, undefined);
});

test('reconciliation: expected bank amounts net of withholding, one bank line per invoice, upload-only import', async () => {
  // A goods sale above the threshold with a withholding receipt: the customer pays grand total − 3 %.
  const sale = (await call('POST', '/sales', { ...header({ vat_receipt_no: 'FS9001', party_tin: '0077777777', party_name: 'Big Buyer PLC' }), lines: [line(1, 100000, 1)] })).data;
  const withWh = (await call('PUT', `/sales/${sale.id}/withholding`, { wh_receipt_type: 'With Receipt' })).data;
  assert.equal(withWh.wh.expected, 3000);
  const due = withWh.amount_due;

  const rec = (await call('GET', '/reconciliation/sales?status=all&search=FS')).data;
  assert.ok(Array.isArray(rec));
  const row = (await call('GET', `/reconciliation/sales?status=all&search=${sale.invoice_no}`)).data[0];
  assert.equal(row.withholding, 3000);
  assert.equal(row.expected_payment, due);

  // Two identical bank credits: auto-match links the invoice to one of them only.
  const bank = (await call('GET', '/reconciliation/banks')).data[0];
  await call('POST', '/reconciliation/transactions', { bank_account_id: bank.id, credit: due });
  await call('POST', '/reconciliation/transactions', { bank_account_id: bank.id, credit: due });
  const match = (await call('POST', '/reconciliation/auto-match')).data;
  assert.equal(match.details.filter((d) => d.invoice_no === sale.invoice_no).length, 1);
  const after = (await call('GET', `/reconciliation/sales?status=reconciled&search=${sale.invoice_no}`)).data;
  assert.equal(after.length, 1);
  assert.equal(after[0].difference, 0);

  // Statement rows compute the same expected amount.
  const txs = (await call('GET', `/reconciliation/transactions?bankAccountId=${bank.id}`)).data;
  const linked = txs.find((t) => t.sales_code_1 === sale.invoice_no);
  assert.equal(linked.sales_expected, due);
  assert.equal(linked.sales_reconciled, true);

  // A blank bank code on edit is regenerated, as the form promises.
  const edited = (await call('PUT', `/reconciliation/transactions/${linked.id}`, { ...linked, bank_code: '' })).data;
  assert.equal(edited.bank_code, `${bank.bank_name}${String(linked.row_no).padStart(3, '0')}`);

  // The server never opens paths it is sent; a non-workbook upload is a 400, not a 500.
  const byPath = await call('POST', '/reconciliation/import', { filePath: 'C:\\Windows\\win.ini' });
  assert.equal(byPath.status, 400);
  const junk = await call('POST', '/reconciliation/import', undefined, { raw: Buffer.from('not a workbook') });
  assert.equal(junk.status, 400);

  const file = await xlsx('Bank 01', [['No', 'Bank Code'], [1, 'CBE900', null, null, null, 0, null, null, null, null, null, 25, null, null, null, '12/05/2026']]);
  const imp = await call('POST', '/reconciliation/import', undefined, { raw: file });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  const imported = (await call('GET', `/reconciliation/transactions?bankAccountId=${bank.id}&search=CBE900`)).data[0];
  assert.equal(imported.value_date, '2026-05-12');
});

test('reports, dashboard and reconciliation only show the companies a restricted user may see', async () => {
  const roles = (await call('GET', '/roles')).data;
  const accountant = roles.find((r) => r.name === 'accountant');
  const mine = (await call('POST', '/parties', { tin: '0012121212', name: 'Mine PLC', type: 'Customer', create_login: false })).data;
  await call('POST', '/sales', { ...header({ vat_receipt_no: 'FS9501', party_tin: '0012121212', party_name: 'Mine PLC' }), lines: [line(1, 1000, 1)] });
  await call('POST', '/users', { username: 'scoped', full_name: 'Scoped', password: 'Scoped-pass-1', role_id: accountant.id, access_all_parties: false, party_ids: [mine.id] });
  let cookie = await login('scoped', 'Scoped-pass-1');
  await call('POST', '/auth/password', { current_password: 'Scoped-pass-1', new_password: 'Scoped-pass-2', confirm: 'Scoped-pass-2' }, { cookie });
  cookie = await login('scoped', 'Scoped-pass-2');

  const dash = await call('GET', '/dashboard?fy=2019', undefined, { cookie });
  assert.equal(dash.status, 200, JSON.stringify(dash.data));
  assert.equal(dash.data.totals.salesCount, 1);
  assert.ok(dash.data.recent.every((r) => r.party_name === 'Mine PLC'));

  const customers = (await call('GET', '/reports/parties/sales?fy=2019', undefined, { cookie })).data;
  assert.deepEqual(customers.map((c) => c.name), ['Mine PLC']);
  const monthly = (await call('GET', '/reports/monthly?fy=2019', undefined, { cookie })).data;
  assert.equal(monthly.total.sales_count, 1);

  const recSales = (await call('GET', '/reconciliation/sales?status=all&search=', undefined, { cookie })).data;
  assert.ok(recSales.every((r) => r.party_name === 'Mine PLC'));
});

test('lookups and settings: shapes the pages read', async () => {
  // Reconciliation's bank picker reads values.bank as [{value, label}].
  const lk = (await call('GET', '/lookups')).data;
  assert.ok(Array.isArray(lk.values.bank) && lk.values.bank[0].value && lk.values.bank[0].label);

  // A blank tax rule is rejected instead of silently becoming 0.
  const blank = await call('PUT', '/settings', { wh_rate: '' });
  assert.equal(blank.status, 400);
  assert.ok(blank.data.fields.wh_rate);
  assert.equal((await call('PUT', '/settings', { wh_rate: 0.03 })).status, 200);

  // Role form errors carry field keys for the inputs.
  const role = await call('POST', '/roles', { name: 'x', label: '' });
  assert.equal(role.status, 400);
  assert.ok(role.data.fields.name || role.data.fields.label);

  // Role changes appear in the activity log.
  const made = await call('POST', '/roles', { name: 'auditor', label: 'Auditor', permissions: {} });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const log = (await call('GET', '/audit?entity=role')).data;
  assert.ok(log.some((e) => /Auditor/.test(e.summary)));
});

test('role-editor tasks are enforced: a switched-off task is refused even though its right is on', async () => {
  // Purchases: edit invoices but not record payments. Reconciliation: add entries but not import.
  // Users: update accounts but not assign roles/companies.
  const role = await call('POST', '/roles', {
    name: 'task_clerk',
    label: 'Task clerk',
    permissions: {
      purchases: { view: true, create: true, edit: true, update_purchase: true, record_payment_p: false },
      reconciliation: { view: true, create: true, edit: true, import_bank: false, create_bank_tx: true, run_automatch: false },
      users: { view: true, edit: true, update_user: true, assign_roles_companies: false },
    },
  });
  assert.equal(role.status, 201, JSON.stringify(role.data));
  await call('POST', '/users', { username: 'taskclerk', full_name: 'Task Clerk', password: 'Clerk-pass-1', role_id: role.data.id, access_all_parties: true });
  let cookie = await login('taskclerk', 'Clerk-pass-1');
  await call('POST', '/auth/password', { current_password: 'Clerk-pass-1', new_password: 'Clerk-pass-2', confirm: 'Clerk-pass-2' }, { cookie });
  cookie = await login('taskclerk', 'Clerk-pass-2');
  const as = (method, url, body, opts = {}) => call(method, url, body, { cookie, ...opts });

  // Purchases: the invoice can be changed, but no credit payment recorded on it.
  const inv = (await call('POST', '/purchases', { ...header({ vat_receipt_no: 'FS9601', payment_type: 'Credit' }), lines: [line(1, 500, 3)] })).data;
  assert.equal((await as('POST', '/purchases/report-status', { ids: [inv.id], status: 'Reported' })).status, 201);
  const pay = await as('POST', `/purchases/${inv.id}/payments`, { date: '2026-09-20', amount: 100, method: 'Cash' });
  assert.equal(pay.status, 403);
  assert.equal(pay.data.code, 'NO_PERMISSION');

  // Reconciliation: entries yes, import and auto-match no.
  const bank = (await as('GET', '/reconciliation/banks')).data[0];
  assert.equal((await as('POST', '/reconciliation/transactions', { bank_account_id: bank.id, debit: 1 })).status, 201);
  assert.equal((await as('POST', '/reconciliation/import', undefined, { raw: Buffer.from('x') })).status, 403);
  assert.equal((await as('POST', '/reconciliation/auto-match')).status, 403);

  // Users: renaming is allowed, changing the role or company access is not.
  const target = (await call('GET', '/users')).data.find((u) => u.username === 'newbie');
  const rename = await as('PUT', `/users/${target.id}`, { full_name: 'Renamed Newbie' });
  assert.equal(rename.status, 200, JSON.stringify(rename.data));
  const reassign = await as('PUT', `/users/${target.id}`, { role_id: role.data.id });
  assert.equal(reassign.status, 403);
  // Sending the unchanged role along with a rename (as the form may) is not a role change.
  assert.equal((await as('PUT', `/users/${target.id}`, { full_name: 'Newbie Again', role_id: target.role_id })).status, 200);

  // /auth/me carries the task keys the UI uses to hide these buttons.
  const me = (await as('GET', '/auth/me')).data;
  assert.equal(me.permissions.purchases.record_payment_p, false);
  assert.equal(me.permissions.reconciliation.import_bank, false);
});

test('reconciliation: one sign everywhere, field-level form errors', async () => {
  // Bank paid less than expected → negative difference on the invoice tab, like on the statement rows.
  const sale = (await call('POST', '/sales', { ...header({ vat_receipt_no: 'FS9701', party_tin: '0088888888', party_name: 'Short Payer PLC' }), lines: [line(1, 1000, 1)] })).data;
  const bank = (await call('GET', '/reconciliation/banks')).data[1];
  await call('POST', '/reconciliation/transactions', { bank_account_id: bank.id, credit: sale.amount_due - 50, sales_code_1: sale.invoice_no });
  const row = (await call('GET', `/reconciliation/sales?status=all&search=${sale.invoice_no}`)).data[0];
  assert.equal(row.difference, -50);
  assert.equal(row.status, 'Partial');
  const tx = (await call('GET', `/reconciliation/transactions?bankAccountId=${bank.id}`)).data.find((t) => t.sales_code_1 === sale.invoice_no);
  assert.equal(tx.sales_difference, -50);

  // Errors come back keyed by the form fields the modals render.
  const badTx = await call('POST', '/reconciliation/transactions', { bank_account_id: 99999, debit: -5, credit: 'abc', value_date: '2026-13-45' });
  assert.equal(badTx.status, 400);
  assert.deepEqual(Object.keys(badTx.data.fields).sort(), ['bank_account_id', 'credit', 'debit', 'value_date']);
  const badAcc = await call('POST', '/reconciliation/banks', { account_no: 0, bank_name: '', opening_balance: 'x' });
  assert.equal(badAcc.status, 400);
  assert.deepEqual(Object.keys(badAcc.data.fields).sort(), ['account_no', 'bank_name', 'opening_balance']);
  const dupAcc = await call('POST', '/reconciliation/banks', { account_no: 1, bank_name: 'CBE' });
  assert.equal(dupAcc.status, 409);
  assert.ok(dupAcc.data.fields.account_no);
  const blankName = await call('PUT', `/reconciliation/banks/${bank.id}`, { bank_name: '' });
  assert.ok(blankName.data.fields.bank_name);
});

test('activity log: a user edit mentions the role only when it changes', async () => {
  const target = (await call('GET', '/users')).data.find((u) => u.username === 'newbie');
  await call('PUT', `/users/${target.id}`, { full_name: 'Newbie Logged', role_id: target.role_id, role: 'viewer' });
  const entry = (await call('GET', '/audit?entity=user&limit=5')).data.find((e) => e.action === 'update');
  assert.doesNotMatch(entry.summary, /role/);
});

test('page reference data comes from the API: rules, exports, aging buckets, activity areas', async () => {
  // Invoice form preview uses the same resolved rules the API calculates with.
  const settings = (await call('GET', '/settings')).data;
  assert.deepEqual(Object.keys(settings.rules).sort(), ['vat_rate', 'wh_goods_threshold', 'wh_rate', 'wh_service_threshold']);
  assert.equal(settings.rules.wh_rate, 0.03);

  // Export catalogue: everything for the admin, only what the role allows for others, and every
  // listed path really downloads.
  const all = (await call('GET', '/exports')).data;
  assert.ok(all.length >= 12);
  assert.ok(all.every((x) => x.id && x.label && x.path.startsWith('/export') && typeof x.period === 'boolean' && !('grants' in x)));
  for (const x of all) {
    const res = await call('GET', `${x.path}${x.period ? '?fy=2019' : ''}`);
    assert.equal(res.status, 200, `${x.path} → ${res.status}`);
  }
  const viewerCookie = await login('newbie', 'Newbie-pass-1');
  const viewerExports = (await call('GET', '/exports', undefined, { cookie: viewerCookie })).data.map((x) => x.id);
  const viewer = (await call('GET', '/roles')).data.find((r) => r.name === 'viewer');
  for (const id of viewerExports) {
    const x = all.find((e) => e.id === id);
    const res = await call('GET', `${x.path}${x.period ? '?fy=2019' : ''}`, undefined, { cookie: viewerCookie });
    assert.equal(res.status, 200, `viewer is offered ${id} but gets ${res.status}`);
  }
  assert.ok(viewer && viewerExports.length > 0);
  // A role without any export right is offered nothing (task clerk from the role-task test).
  const clerk = await login('taskclerk', 'Clerk-pass-2');
  assert.deepEqual((await call('GET', '/exports', undefined, { cookie: clerk })).data, []);

  // Credit aging: the bucket labels match what rows carry in age_bucket.
  const buckets = (await call('GET', '/credit/buckets')).data.map((b) => b.label);
  assert.deepEqual(buckets, ['0–30', '31–60', '61–90', '90+']);
  const rows = (await call('GET', '/credit/purchases?all=1')).data;
  assert.ok(rows.every((r) => buckets.includes(r.age_bucket)));

  // Activity log areas cover every entity the log has recorded so far.
  const areas = (await call('GET', '/audit/entities')).data.map((e) => e.id);
  const recorded = new Set((await call('GET', '/audit?limit=500')).data.map((e) => e.entity));
  for (const e of recorded) assert.ok(areas.includes(e), `area ${e} missing from /audit/entities`);

  // Role editor: resources carry their tasks, and the right columns are served.
  const res = (await call('GET', '/roles/resources')).data;
  assert.deepEqual(res.rights.map((r) => r.id), ['create', 'view', 'edit', 'delete', 'export']);
  assert.ok(res.resources.every((r) => Array.isArray(r.tasks) && r.tasks.length));
});
