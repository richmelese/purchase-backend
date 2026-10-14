// End-to-end API tests: starts the compiled server on a throw-away database and drives it over HTTP,
// sending the same headers the Next.js backend-for-frontend sends.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SECRET = 'test-bff-secret';
let server; let dir; let cookie = '';

const call = async (method, url, body, { headers = {}, auth = true } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'x-bff-secret': SECRET,
      ...(auth && cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-api-'));
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATABASE_PATH: path.join(dir, 'psm.db'), BFF_SHARED_SECRET: SECRET, CORS_ORIGIN: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('only the BFF may call the API; health stays open', async () => {
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
  const direct = await fetch(`${BASE}/auth/status`);
  assert.equal(direct.status, 403);
  const wrong = await fetch(`${BASE}/auth/status`, { headers: { 'x-bff-secret': 'nope-nope-nope-n' } });
  assert.equal(wrong.status, 403);
});

test('first sign-up becomes the administrator; sessions use an HttpOnly cookie', async () => {
  assert.equal((await call('GET', '/auth/status')).data.hasUsers, false);
  assert.equal((await call('GET', '/auth/me')).status, 401);

  const signup = await call('POST', '/auth/signup', { username: 'admin', full_name: 'Admin', password: 'correct-horse-1' });
  assert.equal(signup.status, 201);

  const login = await call('POST', '/auth/login', { username: 'admin', password: 'correct-horse-1' }, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(login.status, 201);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /^psm_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
  assert.match(setCookie, /; Secure/); // the BFF's X-Forwarded-Proto is honoured
  cookie = setCookie.split(';')[0];

  const me = await call('GET', '/auth/me');
  assert.equal(me.data.username, 'admin');
  assert.equal(me.data.role, 'admin');
  assert.deepEqual(me.data.assigned_parties, []);
});

test('login lockout is per client address forwarded by the BFF', async () => {
  const bad = (ip) => call('POST', '/auth/login', { username: 'admin', password: 'wrong-password' }, { auth: false, headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < 5; i++) assert.equal((await bad('10.0.0.7')).status, 401);
  assert.equal((await bad('10.0.0.7')).status, 429);
  assert.equal((await bad('10.0.0.8')).status, 401); // another client is not locked out
});

test('rotating the forwarded address does not allow unlimited guessing', async () => {
  const bad = (ip) => call('POST', '/auth/login', { username: 'guessme', password: 'wrong-password' }, { auth: false, headers: { 'x-forwarded-for': ip } });
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await bad(`192.0.2.${i + 1}`)).status);
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(401));
  assert.equal(statuses[20], 429);
});

const header = (over = {}) => ({
  payment_type: 'Cash', vat_category: 'G', calendar_type: 'G', party_tin: '0000030603', party_name: 'Ethio telecom',
  date: '2026-09-15', receipt_type: 'MRC', mrc_number: 'ABC123', vat_receipt_no: 'FS0001', ...over,
});
const laptop = (qty, unit_price, tx_type) => ({ product_code: 'LAP', description: 'Laptop', unit: 7, tx_type, transaction_type: 'Vatable', qty, unit_price });

test('purchases: validation, numbering, VAT and duplicate receipts', async () => {
  const product = await call('POST', '/products', { code: 'LAP', name_en: 'Laptop', unit: 7, track_stock: 1, opening_stock: 2, min_stock: 1 });
  assert.equal(product.status, 201, JSON.stringify(product.data));

  const invalid = await call('POST', '/purchases', header({ mrc_number: '', lines: [] }));
  assert.equal(invalid.status, 400);
  assert.ok(invalid.data.fields.mrc_number && invalid.data.fields.lines);

  assert.equal((await call('GET', '/purchases/next-number')).data.number, 'P0001');
  const p = await call('POST', '/purchases', header({ lines: [laptop(5, 30000, 3)] }));
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.invoice_no, 'P0001');
  assert.equal(p.data.fy, 2019);
  assert.equal(p.data.fy_month, 2);
  assert.equal(p.data.vat_amount, 22500);
  assert.equal(p.data.wh.status, 'Goods WH');

  const dup = await call('POST', '/purchases', header({ lines: [laptop(1, 1, 3)] }));
  assert.equal(dup.status, 409);

  const prefix = await call('POST', '/purchases', header({ receipt_type: 'Manual', vat_receipt_no: '7781', lines: [laptop(1, 1, 3)] }));
  assert.equal(prefix.status, 400);
  assert.match(prefix.data.fields.vat_receipt_no, /start with “M”/);

  // a purchase is not a sale
  assert.equal((await call('GET', `/sales/${p.data.id}`)).status, 404);
  assert.equal((await call('GET', `/purchases/${p.data.id}`)).data.invoice_no, 'P0001');
});

test('sales on credit, payments, stock and the VAT declaration', async () => {
  const s = await call('POST', '/sales', header({
    payment_type: 'Credit', party_tin: '1111111111', party_name: 'Buyer PLC', vat_receipt_no: 'FS0002', lines: [laptop(3, 40000, 1)],
  }));
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.invoice_no, 'S0001');
  assert.equal(s.data.balance, 138000);

  const paid = await call('POST', `/sales/${s.data.id}/payments`, { date: '2026-09-20', amount: 38000 });
  assert.equal(paid.data.balance, 100000);
  assert.equal((await call('POST', `/sales/${s.data.id}/payments`, { date: '2026-09-20', amount: 200000 })).status, 400);

  const lap = (await call('GET', '/products')).data.find((p) => p.code === 'LAP');
  assert.equal(lap.current_stock, 4); // 2 opening + 5 in − 3 out

  const vat = (await call('GET', '/vat?fy=2019')).data;
  const at = (no, m = 2) => vat.lines.find((l) => l.no === no).values[m]; // Meskerem
  assert.equal(at(5), 120000);
  assert.equal(at(10), 18000);
  assert.equal(at(100), 150000);
  assert.equal(at(105), 22500);
  assert.equal(at(190), 4500);
  assert.equal(at(195, 3), 4500); // credit carries into the following month
});

test('dropdown lists can be reordered with POST …/move (as the UI calls it)', async () => {
  const { lists, values } = (await call('GET', '/lookups')).data;
  const list = lists.find((l) => l.editable && values[l.list].length > 1)?.list;
  assert.ok(list, 'an editable list with two or more values');
  const [first, second] = values[list];
  const moved = await call('POST', `/lookups/${list}/${encodeURIComponent(second.value)}/move`, { dir: 'up' });
  assert.ok(moved.status < 300, JSON.stringify(moved.data));
  const afterMove = (await call('GET', '/lookups')).data.values[list];
  assert.deepEqual([afterMove[0].value, afterMove[1].value], [second.value, first.value]);
});

test('Excel export downloads as a workbook', async () => {
  for (const path of [
    '/export/purchases',
    '/export/sales',
    '/export/vat',
    '/export/stock',
    '/export/withholding',
    '/export/credit',
    '/export/all',
    '/export/list/lookups',
    '/export/report/suppliers',
    '/export/report/customers',
  ]) {
    const res = await call('GET', path);
    assert.equal(res.status, 200, `Failed for ${path}: ${JSON.stringify(res.data)}`);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    assert.equal(Buffer.from(res.data).subarray(0, 2).toString(), 'PK');
  }
});

test('company profile: defaults, validation and saving', async () => {
  const first = (await call('GET', '/company-profile')).data;
  assert.equal(first.receipts.items.length, 12);
  assert.equal(first.receipt_status.items.length, 5);
  assert.deepEqual(first.banks.items, []);
  assert.equal(first.options.max_banks, 12);

  const bad = await call('PUT', '/company-profile', {
    general: { company_name: '', tin: '12AB', business_type: 'LLC' },
    address: { email: 'not-an-email' },
    banks: { items: [{ account_number: '1000', opened: '2024-05-01', closed: '2024-01-01' }] },
    receipt_status: { mor_new_ordered: 2, mor_new_collected: 5 },
  });
  assert.equal(bad.status, 400);
  for (const k of ['general.company_name', 'general.tin', 'general.business_type', 'address.email', 'banks.items.0.bank_name', 'banks.items.0.closed', 'receipt_status.mor_new_collected']) {
    assert.ok(bad.data.fields[k], `expected error for ${k}`);
  }

  const saved = await call('PUT', '/company-profile', {
    general: { round: '1st', company_name: 'Epiccenter Trading PLC', tin: '0012345678', vat_registered: true, vat_number: '123456', business_type: 'PLC', tin_copy: true },
    address: { region: 'Addis Ababa', zone: 'Bole', woreda: '03', house_no: '123', location: 'Near Edna Mall', email: 'info@example.com' },
    contacts: { owner: { name: 'Abebe K.', phone: '0911000000' }, other: { title: 'Auditor', name: 'Sara' } },
    licenses: { items: [{ license_no: 'BL/123', field: 'Computer trade', status: 'Active', registration_date: '2020-01-15' }, {}], license_total: 3, license_collected: 2 },
    banks: { items: [{ bank_name: 'CBE', account_number: '1000123456789', opened: '2020-02-01', branch: 'Bole' }] },
    receipts: { items: [{ type: 'Purchase Voucher (PV)', requirement: 'Required', print_status: 'Printed' }] },
    receipt_status: { items: [{ type: 'Cash Sales Invoice | VAT', current: 'Birhan & Selam', collection: 'Collected', old_void: 'Void' }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.updated_by, 'admin');
  assert.equal(saved.data.licenses.items.length, 1); // empty row dropped

  const again = (await call('GET', '/company-profile')).data;
  assert.equal(again.contacts.other.title, 'Auditor');
  assert.equal(again.receipts.items[3].requirement, 'Required');
  assert.equal(again.receipt_status.items[0].current, 'Birhan & Selam');
  const settings = (await call('GET', '/settings')).data;
  assert.equal(settings.company_tin, '0012345678');
  assert.equal(settings.company_address, 'Near Edna Mall, H.No 123, Woreda 03, Bole, Addis Ababa');
});

test('suppliers and customers carry their own registration profile', async () => {
  const template = (await call('GET', '/parties/profile-template')).data;
  assert.equal(template.profile.receipts.items.length, 12);
  assert.equal(template.options.max_banks, 12);

  const basic = await call('POST', '/parties', { tin: '0099887766', name: 'Abay Networking PLC', type: 'Supplier', phone: '0911 445 120', address: 'Kazanchis' });
  assert.equal(basic.status, 201, JSON.stringify(basic.data));
  const id = basic.data.id;

  // not filled in yet: pre-filled from the basic fields
  const fresh = (await call('GET', `/parties/${id}`)).data;
  assert.equal(fresh.profile.general.company_name, 'Abay Networking PLC');
  assert.equal(fresh.profile.address.location, 'Kazanchis');
  assert.equal(fresh.profile.address.phone, '0911 445 120');
  assert.equal(fresh.options.max_licenses, 10);
  assert.equal(fresh.has_profile, false);

  const bad = await call('PUT', `/parties/${id}`, { name: 'Abay Networking PLC', tin: '0099887766', type: 'Supplier', profile: { address: { email: 'nope' }, banks: { items: [{ bank_name: 'CBE', opened: '2024-02-01', closed: '2023-01-01' }] } } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields['profile.address.email'] && bad.data.fields['profile.banks.items.0.closed']);

  const ok = await call('PUT', `/parties/${id}`, {
    name: 'Abay Networking PLC', tin: '0099887766', type: 'Supplier', mrc1: 'MRC-ABN-07',
    profile: {
      general: { business_type: 'PLC', vat_registered: true, vat_number: '778899', company_name: 'ignored', tin: '1' },
      address: { region: 'Addis Ababa', zone: 'Kirkos', location: 'Kazanchis', phone: '0911 445 120', email: 'sales@abay.example' },
      banks: { items: [{ bank_name: 'Awash Bank', account_number: '01320456789', opened: '2021-03-01', branch: 'Kazanchis' }] },
    },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.email, 'sales@abay.example');            // contact details follow the profile
  assert.equal(ok.data.address, 'Kazanchis, Kirkos, Addis Ababa');
  assert.equal(ok.data.profile, undefined);                      // never in list-style responses

  const full = (await call('GET', `/parties/${id}`)).data;
  assert.equal(full.has_profile, true);
  assert.equal(full.profile.general.company_name, 'Abay Networking PLC'); // name/TIN come from the company itself
  assert.equal(full.profile.general.tin, '0099887766');
  assert.equal(full.profile.banks.items[0].bank_name, 'Awash Bank');

  const list = (await call('GET', '/parties')).data;
  assert.ok(list.every((p) => !('profile' in p)));
  // saving without a profile (e.g. Excel import, older screens) leaves the profile untouched
  await call('PUT', `/parties/${id}`, { name: 'Abay Networking PLC', tin: '0099887766', type: 'Both' });
  assert.equal((await call('GET', `/parties/${id}`)).data.profile.banks.items.length, 1);
});

test('company accounts: generated login, forced password change, own data only', async () => {
  const as = (c) => ({ headers: { cookie: c }, auth: false });
  const login = async (username, password) => {
    const r = await call('POST', '/auth/login', { username, password }, { auth: false });
    return { ...r, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };

  // registering a company generates its login (shown once)
  const reg = await call('POST', '/parties', { tin: '0045217890', name: 'Habesha Computer Trading PLC', type: 'Supplier' });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.account.username, '0045217890');
  assert.match(reg.data.account.password, /^[A-Za-z2-9]{10}$/);
  const partyId = reg.data.id;
  const other = (await call('POST', '/parties', { tin: '0061234508', name: 'Other Supplier PLC', type: 'Both', create_login: false })).data;
  assert.equal(other.account, null);
  assert.equal((await call('GET', '/parties')).data.find((p) => p.id === partyId).login_username, '0045217890');

  // transactions with this company and with another one
  const inv = (tin, name, no, kind = 'purchases') => call('POST', `/${kind}`, header({
    party_tin: tin, party_name: name, vat_receipt_no: no,
    lines: [{ description: 'Router', unit: 7, tx_type: kind === 'sales' ? 1 : 3, transaction_type: 'Vatable', qty: 1, unit_price: 1000 }],
  }));
  const mine = (await inv('0045217890', 'Habesha Computer Trading PLC', 'FS9100')).data;
  const mySale = (await inv('0045217890', 'Habesha Computer Trading PLC', 'FS9101', 'sales')).data;
  const theirs = (await inv('0061234508', 'Other Supplier PLC', 'FS9102')).data;
  assert.ok(mine.id && mySale.id && theirs.id);

  // first sign-in: only "who am I" and "change password" work
  const first = await login('0045217890', reg.data.account.password);
  assert.equal(first.status, 201);
  assert.equal(first.data.user.must_change_password, true);
  assert.equal(first.data.user.party_id, partyId);
  const me = await call('GET', '/auth/me', undefined, as(first.cookie));
  assert.equal(me.data.company_name, 'Habesha Computer Trading PLC');
  const blocked = await call('GET', '/portal/company', undefined, as(first.cookie));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED');

  assert.equal((await call('POST', '/auth/password', { current_password: 'wrong-one', new_password: 'Habesha-2026!' }, as(first.cookie))).status, 400);
  assert.equal((await call('POST', '/auth/password', { current_password: reg.data.account.password, new_password: reg.data.account.password }, as(first.cookie))).status, 400);
  assert.equal((await call('POST', '/auth/password', { current_password: reg.data.account.password, new_password: 'Habesha-2026!' }, as(first.cookie))).status, 201);
  assert.equal((await call('GET', '/auth/me', undefined, as(first.cookie))).data.must_change_password, false);

  // the portal shows this company only
  const co = (await call('GET', '/portal/company', undefined, as(first.cookie))).data;
  assert.equal(co.company.name, 'Habesha Computer Trading PLC');
  assert.equal(co.account.username, '0045217890');
  const purchases = (await call('GET', '/portal/invoices?kind=P', undefined, as(first.cookie))).data;
  assert.deepEqual(purchases.map((i) => i.id), [mine.id]);
  assert.deepEqual((await call('GET', '/portal/invoices?kind=S', undefined, as(first.cookie))).data.map((i) => i.id), [mySale.id]);
  assert.equal((await call('GET', `/portal/invoices/${mine.id}`, undefined, as(first.cookie))).data.lines.length, 1);
  assert.equal((await call('GET', `/portal/invoices/${theirs.id}`, undefined, as(first.cookie))).status, 404);
  const st = (await call('GET', '/portal/statement', undefined, as(first.cookie))).data;
  assert.equal(st.party.id, partyId);
  assert.equal(st.totals.purchaseCount, 1);

  // …and nothing of the business's own data
  for (const [m, url] of [['GET', '/purchases'], ['GET', `/purchases/${theirs.id}`], ['GET', '/sales'], ['GET', '/parties'], ['GET', `/parties/${other.id}`],
    ['GET', '/dashboard'], ['GET', '/vat'], ['GET', '/settings'], ['GET', '/company-profile'], ['GET', '/users'], ['GET', '/export/purchases'],
    ['GET', '/backup'], ['GET', '/reports/monthly'], ['GET', '/products'], ['POST', '/parties'], ['POST', '/purchases']]) {
    const r = await call(m, url, m === 'POST' ? {} : undefined, as(first.cookie));
    assert.equal(r.status, 403, `${m} ${url} should be refused, got ${r.status}`);
  }

  // an administrator cannot turn the company login into staff
  const users = (await call('GET', '/users')).data;
  const acct = users.find((u) => u.party_id === partyId);
  assert.equal(acct.role_label, 'Company account');
  await call('PUT', `/users/${acct.id}`, { full_name: acct.full_name, role: 'admin', access_all_parties: true });
  assert.equal((await call('GET', '/purchases', undefined, as(first.cookie))).status, 403);

  // password reset: new password, old sessions ended, change required again
  const reset = await call('POST', `/parties/${partyId}/account`);
  assert.equal(reset.data.created, false);
  assert.equal(reset.data.username, '0045217890');
  assert.equal((await call('GET', '/auth/me', undefined, as(first.cookie))).status, 401);
  const again = await login('0045217890', reset.data.password);
  assert.equal(again.data.user.must_change_password, true);

  // a company without a login can get one later
  const later = await call('POST', `/parties/${other.id}/account`);
  assert.equal(later.data.created, true);
  assert.equal(later.data.username, '0061234508');
});

test('staff users: role + companies chosen at creation, first-login password change, permissions enforced', async () => {
  const as = (c) => ({ headers: { cookie: c }, auth: false });
  const login = async (username, password) => {
    const r = await call('POST', '/auth/login', { username, password }, { auth: false });
    return { ...r, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const roles = (await call('GET', '/roles')).data;
  const salesOfficer = roles.find((r) => r.name === 'sales_officer');
  const adminRole = roles.find((r) => r.name === 'admin');
  const X = (await call('POST', '/parties', { tin: '0071000001', name: 'Customer X PLC', type: 'Customer', create_login: false })).data;
  const Y = (await call('POST', '/parties', { tin: '0071000002', name: 'Customer Y PLC', type: 'Customer', create_login: false })).data;
  const saleFor = (tin, name, no) => ({
    ...header({ party_tin: tin, party_name: name, vat_receipt_no: no }),
    lines: [{ description: 'Switch', unit: 7, tx_type: 1, transaction_type: 'Vatable', qty: 1, unit_price: 500 }],
  });
  const ySale = (await call('POST', '/sales', saleFor('0071000002', 'Customer Y PLC', 'FS9201'))).data;

  // role and company access are required when the account is created
  const noRole = await call('POST', '/users', { username: 'clerk', full_name: 'Clerk', password: 'Temp-pass-1', access_all_parties: false, party_ids: [] });
  assert.equal(noRole.status, 400);
  assert.ok(noRole.data.fields.role_id && noRole.data.fields.party_ids);
  const created = await call('POST', '/users', { username: 'clerk', full_name: 'Clerk', password: 'Temp-pass-1', role_id: salesOfficer.id, access_all_parties: false, party_ids: [X.id] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const clerkRow = created.data.find((u) => u.username === 'clerk');
  assert.equal(clerkRow.must_change_password, true);
  assert.deepEqual(clerkRow.assigned_party_ids, [X.id]);

  // first sign-in: change the temporary password before anything else
  let clerk = await login('clerk', 'Temp-pass-1');
  assert.equal(clerk.data.user.must_change_password, true);
  assert.equal((await call('GET', '/sales', undefined, as(clerk.cookie))).data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('POST', '/auth/password', { current_password: 'Temp-pass-1', new_password: 'Clerk-own-pass-2' }, as(clerk.cookie))).status, 201);

  // the role decides what is allowed …
  const me = (await call('GET', '/auth/me', undefined, as(clerk.cookie))).data;
  assert.equal(me.role_name, 'sales_officer');
  assert.equal(me.permissions.sales.create, true);
  assert.equal(me.permissions.purchases.view, false);
  for (const url of ['/sales', '/settings', '/lookups', '/fiscal-years', '/dashboard', '/products', '/parties']) {
    assert.equal((await call('GET', url, undefined, as(clerk.cookie))).status, 200, url);
  }
  for (const [m, url] of [['GET', '/purchases'], ['GET', '/vat'], ['GET', '/users'], ['GET', '/audit'], ['GET', '/company-profile'], ['GET', '/backup'],
    ['GET', '/export/purchases'], ['GET', '/reconciliation/banks'], ['PUT', '/settings'], ['POST', '/products'], ['DELETE', `/sales/${ySale.id}`], ['POST', '/roles']]) {
    const r = await call(m, url, m === 'GET' || m === 'DELETE' ? undefined : {}, as(clerk.cookie));
    assert.equal(r.status, 403, `${m} ${url} -> ${r.status}`);
    assert.equal(r.data.code, 'NO_PERMISSION', url);
  }
  assert.equal((await call('GET', '/export/sales', undefined, as(clerk.cookie))).status, 200);

  // … and the company access decides which records
  const mine = await call('POST', '/sales', saleFor('0071000001', 'Customer X PLC', 'FS9202'), as(clerk.cookie));
  assert.equal(mine.status, 201, JSON.stringify(mine.data));
  const other = await call('POST', '/sales', saleFor('0071000002', 'Customer Y PLC', 'FS9203'), as(clerk.cookie));
  assert.equal(other.status, 400);
  assert.ok(other.data.fields.party_tin);
  assert.deepEqual((await call('GET', '/sales', undefined, as(clerk.cookie))).data.map((i) => i.party_id), [X.id]);
  assert.equal((await call('GET', `/sales/${ySale.id}`, undefined, as(clerk.cookie))).status, 404);
  assert.equal((await call('PUT', `/sales/${ySale.id}`, saleFor('0071000001', 'Customer X PLC', 'FS9204'), as(clerk.cookie))).status, 404);
  assert.deepEqual((await call('GET', '/parties', undefined, as(clerk.cookie))).data.map((p) => p.id), [X.id]);
  assert.equal((await call('GET', `/parties/${Y.id}/statement`, undefined, as(clerk.cookie))).status, 404);
  assert.equal((await call('GET', '/parties/by-tin/0071000002', undefined, as(clerk.cookie))).status, 404);

  // nobody can hand out more than they have
  const sup = (await call('POST', '/roles', { name: 'supervisor', label: 'Supervisor', permissions: { users: { view: true, create: true, edit: true }, sales: { view: true } } })).data;
  await call('POST', '/users', { username: 'sup', full_name: 'Supervisor', password: 'Temp-pass-3', role_id: sup.id, access_all_parties: false, party_ids: [X.id] });
  const s1 = await login('sup', 'Temp-pass-3');
  await call('POST', '/auth/password', { current_password: 'Temp-pass-3', new_password: 'Sup-own-pass-4' }, as(s1.cookie));
  const grant = (body) => call('POST', '/users', { full_name: 'New', password: 'Temp-pass-5', ...body }, as(s1.cookie));
  assert.equal((await grant({ username: 'new1', role_id: adminRole.id, access_all_parties: true })).status, 403);
  assert.equal((await grant({ username: 'new2', role_id: salesOfficer.id, access_all_parties: true })).status, 403);
  assert.equal((await grant({ username: 'new3', role_id: salesOfficer.id, access_all_parties: false, party_ids: [Y.id] })).status, 403);
  assert.equal((await grant({ username: 'new4', role_id: salesOfficer.id, access_all_parties: false, party_ids: [X.id] })).status, 201);
  const users = (await call('GET', '/users')).data;
  const adminUser = users.find((u) => u.username === 'admin');
  const supUser = users.find((u) => u.username === 'sup');
  assert.equal((await call('PUT', `/users/${adminUser.id}`, { full_name: 'Hacked', password: 'Hacked-pass-1' }, as(s1.cookie))).status, 403);
  assert.equal((await call('PUT', `/users/${supUser.id}`, { full_name: 'Supervisor', role_id: adminRole.id }, as(s1.cookie))).status, 400);
  assert.equal((await call('PUT', `/roles/${sup.id}`, { label: 'Supervisor', permissions: { users: { view: true, create: true, edit: true, delete: true } } }, as(s1.cookie))).status, 403);

  // permission changes apply at once
  await call('PUT', `/roles/${sup.id}`, { label: 'Supervisor', permissions: { users: { view: true } } });
  assert.equal((await call('GET', '/sales', undefined, as(s1.cookie))).status, 403);

  // an administrator reset makes the password temporary again and signs the user out
  await call('PUT', `/users/${clerkRow.id}`, { full_name: 'Clerk', password: 'Reset-pass-6' });
  assert.equal((await call('GET', '/auth/me', undefined, as(clerk.cookie))).status, 401);
  clerk = await login('clerk', 'Reset-pass-6');
  assert.equal(clerk.data.user.must_change_password, true);
});

test('rights per company: view-only companies can be seen but not changed', async () => {
  const as = (c) => ({ headers: { cookie: c }, auth: false });
  const login = async (username, password) => {
    const r = await call('POST', '/auth/login', { username, password }, { auth: false });
    return { ...r, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const roles = (await call('GET', '/roles')).data;
  const salesOfficer = roles.find((r) => r.name === 'sales_officer');
  const V = (await call('POST', '/parties', { tin: '0072000001', name: 'View Only Co', type: 'Customer', create_login: false })).data;
  const F = (await call('POST', '/parties', { tin: '0072000002', name: 'Full Rights Co', type: 'Customer', create_login: false })).data;
  const saleFor = (tin, name, no) => ({
    ...header({ party_tin: tin, party_name: name, vat_receipt_no: no }),
    lines: [{ description: 'Cable', unit: 7, tx_type: 1, transaction_type: 'Vatable', qty: 1, unit_price: 300 }],
  });
  const vSale = (await call('POST', '/sales', saleFor('0072000001', 'View Only Co', 'FS9301'))).data;

  const created = await call('POST', '/users', {
    username: 'viewer.f', full_name: 'Per company', password: 'Temp-pass-7', role_id: salesOfficer.id, access_all_parties: false,
    party_ids: [V.id, F.id],
    party_rights: { [V.id]: { view: true }, [F.id]: { view: true, create: true, edit: true, delete: true, export: true } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const row = created.data.find((u) => u.username === 'viewer.f');
  assert.deepEqual(row.assigned_parties.find((p) => p.id === V.id).rights, { view: true, create: false, edit: false, delete: false, export: false });

  const u = await login('viewer.f', 'Temp-pass-7');
  await call('POST', '/auth/password', { current_password: 'Temp-pass-7', new_password: 'Per-company-8' }, as(u.cookie));
  const me = (await call('GET', '/auth/me', undefined, as(u.cookie))).data;
  assert.equal(me.party_rights[V.id].edit, false);
  assert.equal(me.party_rights[F.id].create, true);

  // both companies are visible …
  assert.deepEqual((await call('GET', '/parties', undefined, as(u.cookie))).data.map((p) => p.id).sort(), [V.id, F.id].sort());
  assert.equal((await call('GET', `/sales/${vSale.id}`, undefined, as(u.cookie))).status, 200);
  // … but the view-only one cannot be changed
  const upd = await call('PUT', `/sales/${vSale.id}`, saleFor('0072000001', 'View Only Co', 'FS9301'), as(u.cookie));
  assert.equal(upd.status, 403);
  assert.equal(upd.data.code, 'NO_PERMISSION');
  assert.equal((await call('POST', `/sales/${vSale.id}/payments`, { date: '2026-09-20', amount: 10 }, as(u.cookie))).status, 403);
  assert.equal((await call('PUT', `/parties/${V.id}`, { name: 'Renamed', tin: '0072000001', type: 'Customer' }, as(u.cookie))).status, 403);
  assert.equal((await call('POST', '/sales', saleFor('0072000001', 'View Only Co', 'FS9302'), as(u.cookie))).status, 400);
  assert.equal((await call('POST', '/sales', saleFor('0072000002', 'Full Rights Co', 'FS9303'), as(u.cookie))).status, 201);

  // a restricted user cannot hand out rights they do not hold for a company
  const sup = (await call('POST', '/roles', { name: 'co_supervisor', label: 'Co supervisor', permissions: { users: { view: true, create: true } } })).data;
  await call('POST', '/users', { username: 'co.sup', full_name: 'Co sup', password: 'Temp-pass-9', role_id: sup.id, access_all_parties: false, party_ids: [V.id], party_rights: { [V.id]: { view: true } } });
  const s = await login('co.sup', 'Temp-pass-9');
  await call('POST', '/auth/password', { current_password: 'Temp-pass-9', new_password: 'Co-sup-pass-10' }, as(s.cookie));
  const tooMuch = await call('POST', '/users', { username: 'co.new', full_name: 'X', password: 'Temp-pass-11', role_id: salesOfficer.id, access_all_parties: false, party_ids: [V.id], party_rights: { [V.id]: { view: true, edit: true } } }, as(s.cookie));
  assert.equal(tooMuch.status, 403);
  const ok = await call('POST', '/users', { username: 'co.new', full_name: 'X', password: 'Temp-pass-11', role_id: salesOfficer.id, access_all_parties: false, party_ids: [V.id], party_rights: { [V.id]: { view: true } } }, as(s.cookie));
  assert.equal(ok.status, 201);
});

test('logout ends the session', async () => {
  assert.equal((await call('POST', '/auth/logout')).status, 201);
  assert.equal((await call('GET', '/auth/me')).status, 401);
});
