// Comprehensive test verifying real authentication, role-based access control (RBAC),
// company scoping, and sidebar navigation visibility across all system roles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
const { canOpenPage, can, visibleNav, NAV } = await import(pathToFileURL(path.join(ROOT_DIR, 'lib', 'permissions.js')).href);

const PORT = 5800 + Math.floor(Math.random() * 150);
const SECRET = 'rbac-test-secret-' + crypto.randomBytes(8).toString('hex');
const BASE = `http://127.0.0.1:${PORT}/api`;

let backendProcess;
let tmpDir;

const apiCall = async (method, urlPath, body, { cookie = '', headers = {} } = {}) => {
  const reqHeaders = {
    'x-bff-secret': SECRET,
    ...(cookie ? { cookie } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...headers,
  };
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  return { status: res.status, data, headers: res.headers };
};

// Generated passwords must be replaced on first sign-in; remember the replacement so later
// logins of the same user keep working.
const rotatedPasswords = new Map();

const loginAs = async (username, initialPassword, changePasswordIfRequired = true) => {
  const password = rotatedPasswords.get(username) || initialPassword;
  const res = await apiCall('POST', '/auth/login', { username, password, remember: false });
  assert.ok(res.status === 200 || res.status === 201, `Login failed for ${username}: ${JSON.stringify(res.data)}`);
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const cookiePart = cookies.find((c) => c && c.startsWith('psm_session='));
  assert.ok(cookiePart, 'psm_session cookie missing');
  const cookie = cookiePart.split(';')[0];

  if (res.data?.user?.must_change_password && changePasswordIfRequired) {
    const newPw = 'Active' + password;
    const changed = await apiCall('POST', '/auth/password', {
      current_password: password,
      new_password: newPw,
      confirm: newPw,
    }, { cookie });
    assert.ok(changed.status < 300, `Password change failed for ${username}: ${JSON.stringify(changed.data)}`);
    rotatedPasswords.set(username, newPw);
  }

  return cookie;
};

let adminCookie;
let comp1Id;
let comp2Id;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-rbac-'));

  backendProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(tmpDir, 'psm.db'),
      BFF_SHARED_SECRET: SECRET,
      CORS_ORIGIN: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  for (let i = 0; i < 300; i++) { // cold starts can take well over 10 s
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  // 1. Initial admin signup & login
  await apiCall('POST', '/auth/signup', {
    full_name: 'Super Administrator',
    username: 'admin',
    password: 'AdminPassword123!',
  });
  adminCookie = await loginAs('admin', 'AdminPassword123!');

  // 2. Create standard product
  await apiCall('POST', '/products', {
    code: 'GEN-01',
    name_en: 'Generator 10kVA',
    unit: 7,
    track_stock: 1,
    opening_stock: 10,
    min_stock: 2,
    purchase_price: 50000,
    selling_price: 75000,
  }, { cookie: adminCookie });

  // 3. Create two distinct companies
  const c1 = await apiCall('POST', '/parties', {
    name: 'Alpha Supplier PLC',
    type: 'Supplier',
    tin: '0011111111',
    vat_reg_no: 'VAT-01',
    vat_rate: 0.15,
  }, { cookie: adminCookie });
  comp1Id = c1.data.id;

  const c2 = await apiCall('POST', '/parties', {
    name: 'Beta Buyer PLC',
    type: 'Both',
    tin: '0022222222',
    vat_reg_no: 'VAT-02',
    vat_rate: 0.15,
  }, { cookie: adminCookie });
  comp2Id = c2.data.id;
});

after(() => {
  backendProcess?.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('Role-Based Access Control: Users creation with pre-defined system roles', async () => {
  const roles = await apiCall('GET', '/roles', undefined, { cookie: adminCookie });
  assert.equal(roles.status, 200);
  const roleNames = roles.data.map((r) => r.name);
  assert.ok(roleNames.includes('accountant'));
  assert.ok(roleNames.includes('sales_officer'));
  assert.ok(roleNames.includes('purchase_officer'));
  assert.ok(roleNames.includes('viewer'));

  const accountantRole = roles.data.find((r) => r.name === 'accountant');
  const salesRole = roles.data.find((r) => r.name === 'sales_officer');
  const purchaseRole = roles.data.find((r) => r.name === 'purchase_officer');
  const viewerRole = roles.data.find((r) => r.name === 'viewer');

  // Create users for each role
  const accUserRes = await apiCall('POST', '/users', {
    full_name: 'Abebe Accountant',
    username: 'accountant_user',
    password: 'Password123!',
    role_id: accountantRole.id,
    access_all_parties: true,
  }, { cookie: adminCookie });
  assert.equal(accUserRes.status, 201);

  const salesUserRes = await apiCall('POST', '/users', {
    full_name: 'Sara Sales',
    username: 'sales_user',
    password: 'Password123!',
    role_id: salesRole.id,
    access_all_parties: true,
  }, { cookie: adminCookie });
  assert.equal(salesUserRes.status, 201);

  const purchUserRes = await apiCall('POST', '/users', {
    full_name: 'Paulos Purchases',
    username: 'purch_user',
    password: 'Password123!',
    role_id: purchaseRole.id,
    access_all_parties: true,
  }, { cookie: adminCookie });
  assert.equal(purchUserRes.status, 201);

  const viewerUserRes = await apiCall('POST', '/users', {
    full_name: 'Vicky Viewer',
    username: 'viewer_user',
    password: 'Password123!',
    role_id: viewerRole.id,
    access_all_parties: true,
  }, { cookie: adminCookie });
  assert.equal(viewerUserRes.status, 201);
});

test('Sidebar navigation and page accessibility dynamically adapts to each role', async () => {
  // 1. Admin navigation
  const adminMe = (await apiCall('GET', '/auth/me', undefined, { cookie: adminCookie })).data;
  const adminNav = visibleNav(adminMe).filter((n) => !n.group).map((n) => n.href);
  assert.ok(adminNav.includes('/purchases'));
  assert.ok(adminNav.includes('/sales'));
  assert.ok(adminNav.includes('/reconciliation'));
  assert.ok(adminNav.includes('/withholding'));
  assert.ok(adminNav.includes('/vat'));
  assert.ok(adminNav.includes('/settings?tab=roles'));
  assert.ok(adminNav.includes('/settings?tab=users'));
  assert.ok(adminNav.includes('/settings'));

  // 2. Sales Officer navigation
  const salesCookie = await loginAs('sales_user', 'Password123!');
  const salesMe = (await apiCall('GET', '/auth/me', undefined, { cookie: salesCookie })).data;
  const salesNav = visibleNav(salesMe).filter((n) => !n.group).map((n) => n.href);

  // Allowed in sidebar
  assert.ok(salesNav.includes('/sales'), 'Sales officer must see Sales');
  assert.ok(salesNav.includes('/credit'), 'Sales officer must see Credit');
  assert.ok(salesNav.includes('/parties'), 'Sales officer must see Parties');
  assert.ok(salesNav.includes('/products'), 'Sales officer must see Products');

  // Forbidden in sidebar
  assert.ok(!salesNav.includes('/purchases'), 'Sales officer must NOT see Purchases');
  assert.ok(!salesNav.includes('/reconciliation'), 'Sales officer must NOT see Reconciliation');
  assert.ok(!salesNav.includes('/withholding'), 'Sales officer must NOT see Withholding');
  assert.ok(!salesNav.includes('/vat'), 'Sales officer must NOT see VAT');
  assert.ok(!salesNav.includes('/settings?tab=roles'), 'Sales officer must NOT see Roles');
  assert.ok(!salesNav.includes('/settings?tab=users'), 'Sales officer must NOT see Users');
  assert.ok(salesNav.includes('/settings'), 'Sales officer sees Settings for export tab');

  // CanOpenPage check
  assert.equal(canOpenPage(salesMe, '/sales'), true);
  assert.equal(canOpenPage(salesMe, '/purchases'), false);
  assert.equal(canOpenPage(salesMe, '/vat'), false);
  assert.equal(canOpenPage(salesMe, '/reconciliation'), false);

  // 3. Purchase Officer navigation
  const purchCookie = await loginAs('purch_user', 'Password123!');
  const purchMe = (await apiCall('GET', '/auth/me', undefined, { cookie: purchCookie })).data;
  const purchNav = visibleNav(purchMe).filter((n) => !n.group).map((n) => n.href);

  assert.ok(purchNav.includes('/purchases'), 'Purchase officer must see Purchases');
  assert.ok(!purchNav.includes('/sales'), 'Purchase officer must NOT see Sales');
  assert.ok(!purchNav.includes('/reconciliation'), 'Purchase officer must NOT see Reconciliation');
  assert.ok(!purchNav.includes('/vat'), 'Purchase officer must NOT see VAT');
  assert.ok(!purchNav.includes('/settings?tab=roles'), 'Purchase officer must NOT see Roles');
  assert.ok(!purchNav.includes('/settings?tab=users'), 'Purchase officer must NOT see Users');

  assert.equal(canOpenPage(purchMe, '/purchases'), true);
  assert.equal(canOpenPage(purchMe, '/sales'), false);

  // 4. Accountant navigation
  const accCookie = await loginAs('accountant_user', 'Password123!');
  const accMe = (await apiCall('GET', '/auth/me', undefined, { cookie: accCookie })).data;
  const accNav = visibleNav(accMe).filter((n) => !n.group).map((n) => n.href);

  assert.ok(accNav.includes('/purchases'));
  assert.ok(accNav.includes('/sales'));
  assert.ok(accNav.includes('/reconciliation'));
  assert.ok(accNav.includes('/withholding'));
  assert.ok(accNav.includes('/vat'));
  assert.ok(accNav.includes('/settings')); // allowed for company profile & lookups
  assert.ok(!accNav.includes('/settings?tab=roles'), 'Accountant cannot manage roles');
  assert.ok(!accNav.includes('/settings?tab=users'), 'Accountant cannot manage users');

  // 5. Viewer navigation
  const viewerCookie = await loginAs('viewer_user', 'Password123!');
  const viewerMe = (await apiCall('GET', '/auth/me', undefined, { cookie: viewerCookie })).data;
  const viewerNav = visibleNav(viewerMe).filter((n) => !n.group).map((n) => n.href);

  assert.ok(!viewerNav.includes('/settings?tab=roles'));
  assert.ok(!viewerNav.includes('/settings?tab=users'));
  assert.equal(can(viewerMe, 'purchases', 'create'), false, 'Viewer cannot create purchases');
  assert.equal(can(viewerMe, 'sales', 'create'), false, 'Viewer cannot create sales');
});

test('Backend strictly enforces permissions: 403 Forbidden when role does not permit action', async () => {
  const salesCookie = await loginAs('sales_user', 'Password123!');
  const purchCookie = await loginAs('purch_user', 'Password123!');
  const viewerCookie = await loginAs('viewer_user', 'Password123!');

  const validPurchasePayload = {
    invoice_no: 'P0001',
    date: '2026-09-15',
    payment_type: 'Cash',
    vat_category: 'G',
    calendar_type: 'G',
    receipt_type: 'MRC',
    mrc_number: 'MRC-123',
    vat_receipt_no: 'FS0001',
    party_id: comp1Id,
    party_name: 'Alpha Supplier PLC',
    party_tin: '0011111111',
    lines: [
      {
        product_code: 'GEN-01',
        description: 'Generator 10kVA',
        unit: 7,
        tx_type: 3,
        transaction_type: 'Vatable',
        qty: 1,
        unit_price: 50000,
      },
    ],
  };

  const validSalesPayload = {
    invoice_no: 'S0001',
    date: '2026-09-16',
    payment_type: 'Cash',
    vat_category: 'G',
    calendar_type: 'G',
    receipt_type: 'MRC',
    mrc_number: 'MRC-456',
    vat_receipt_no: 'FS0002',
    party_id: comp2Id,
    party_name: 'Beta Buyer PLC',
    party_tin: '0022222222',
    lines: [
      {
        product_code: 'GEN-01',
        description: 'Generator 10kVA',
        unit: 7,
        tx_type: 1,
        transaction_type: 'Vatable',
        qty: 1,
        unit_price: 75000,
      },
    ],
  };

  // 1. Sales officer tries to create purchase -> 403 Forbidden
  const salesAsBuyer = await apiCall('POST', '/purchases', validPurchasePayload, { cookie: salesCookie });
  assert.equal(salesAsBuyer.status, 403);
  assert.equal(salesAsBuyer.data.code, 'NO_PERMISSION');

  // 2. Purchase officer tries to create sale -> 403 Forbidden
  const purchAsSeller = await apiCall('POST', '/sales', validSalesPayload, { cookie: purchCookie });
  assert.equal(purchAsSeller.status, 403);
  assert.equal(purchAsSeller.data.code, 'NO_PERMISSION');

  // 3. Viewer tries to create purchase -> 403 Forbidden
  const viewerAsBuyer = await apiCall('POST', '/purchases', validPurchasePayload, { cookie: viewerCookie });
  assert.equal(viewerAsBuyer.status, 403);

  // 4. Authorized roles succeed
  const purchSuccess = await apiCall('POST', '/purchases', validPurchasePayload, { cookie: purchCookie });
  assert.equal(purchSuccess.status, 201);

  const salesSuccess = await apiCall('POST', '/sales', validSalesPayload, { cookie: salesCookie });
  assert.equal(salesSuccess.status, 201);
});

test('Company-scoped access: user restricted to specific companies cannot transact on others', async () => {
  const roles = (await apiCall('GET', '/roles', undefined, { cookie: adminCookie })).data;
  const purchRole = roles.find((r) => r.name === 'purchase_officer');

  // Create a purchase officer restricted ONLY to Company 1 (Alpha Supplier PLC)
  const createRes = await apiCall('POST', '/users', {
    full_name: 'Restricted Buyer',
    username: 'restricted_purchaser',
    password: 'Password123!',
    role_id: purchRole.id,
    access_all_parties: false,
    party_ids: [comp1Id],
    party_rights: {
      [comp1Id]: { view: true, create: true, edit: true, delete: false, export: true },
    },
  }, { cookie: adminCookie });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.data));

  const restrictedCookie = await loginAs('restricted_purchaser', 'Password123!');
  const me = (await apiCall('GET', '/auth/me', undefined, { cookie: restrictedCookie })).data;
  assert.equal(me.access_all_parties, false);
  assert.deepEqual(me.assigned_party_ids, [comp1Id]);

  // Attempting to record purchase for Company 2 (Beta Buyer PLC) is rejected
  const illegalPurchase = await apiCall('POST', '/purchases', {
    invoice_no: 'P0002',
    date: '2026-09-17',
    payment_type: 'Cash',
    vat_category: 'G',
    calendar_type: 'G',
    receipt_type: 'MRC',
    mrc_number: 'MRC-789',
    vat_receipt_no: 'FS0003',
    party_id: comp2Id,
    party_name: 'Beta Buyer PLC',
    party_tin: '0022222222',
    lines: [
      {
        product_code: 'GEN-01',
        description: 'Generator 10kVA',
        unit: 7,
        tx_type: 3,
        transaction_type: 'Vatable',
        qty: 1,
        unit_price: 50000,
      },
    ],
  }, { cookie: restrictedCookie });

  assert.equal(illegalPurchase.status, 400);
  assert.match(illegalPurchase.data.error, /only.*record invoices for companies where your access allows it/);

  // Recording purchase for Company 1 succeeds
  const legalPurchase = await apiCall('POST', '/purchases', {
    invoice_no: 'P0002',
    date: '2026-09-17',
    payment_type: 'Cash',
    vat_category: 'G',
    calendar_type: 'G',
    receipt_type: 'MRC',
    mrc_number: 'MRC-789',
    vat_receipt_no: 'FS0004',
    party_id: comp1Id,
    party_name: 'Alpha Supplier PLC',
    party_tin: '0011111111',
    lines: [
      {
        product_code: 'GEN-01',
        description: 'Generator 10kVA',
        unit: 7,
        tx_type: 3,
        transaction_type: 'Vatable',
        qty: 1,
        unit_price: 50000,
      },
    ],
  }, { cookie: restrictedCookie });

  assert.equal(legalPurchase.status, 201);
});
