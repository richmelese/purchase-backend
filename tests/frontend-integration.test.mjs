// End-to-end integration test verifying that the Next.js frontend (BFF + UI pages)
// and the NestJS backend run together and communicate seamlessly over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
const NEXT_BIN = path.join(ROOT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

const BACKEND_PORT = 5700 + Math.floor(Math.random() * 200);
const FRONTEND_PORT = 3700 + Math.floor(Math.random() * 200);
const SECRET = 'int-bff-' + crypto.randomBytes(8).toString('hex');
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

let backendProcess;
let frontendProcess;
let tmpDir;
let sessionCookie = '';

const bff = async (method, urlPath, body, { auth = true, headers = {}, redirect = 'manual' } = {}) => {
  const reqHeaders = {
    ...(auth && sessionCookie ? { cookie: sessionCookie } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...headers,
  };
  const res = await fetch(`${FRONTEND_URL}${urlPath}`, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect,
  });
  const type = res.headers.get('content-type') || '';
  let data;
  if (type.includes('json')) {
    data = await res.json().catch(() => null);
  } else if (type.includes('text') || type.includes('html')) {
    data = await res.text().catch(() => '');
  } else {
    data = await res.arrayBuffer().catch(() => null);
  }
  return { status: res.status, data, headers: res.headers };
};

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-e2e-'));

  // 1. Start NestJS backend on BACKEND_PORT
  backendProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(tmpDir, 'psm.db'),
      BFF_SHARED_SECRET: SECRET,
      CORS_ORIGIN: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // Wait for backend to be healthy
  let backendReady = false;
  for (let i = 0; i < 300; i++) { // cold starts can take well over 10 s
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`);
      if (res.ok) { backendReady = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!backendReady) throw new Error('NestJS backend failed to start');

  // 2. Start Next.js frontend in production mode on FRONTEND_PORT
  frontendProcess = spawn(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(FRONTEND_PORT)], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(FRONTEND_PORT),
      HOST: '127.0.0.1',
      BACKEND_URL,
      BFF_SHARED_SECRET: SECRET,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // Wait for frontend login page to be reachable
  let frontendReady = false;
  for (let i = 0; i < 300; i++) {
    try {
      const res = await fetch(`${FRONTEND_URL}/login`);
      if (res.status === 200) { frontendReady = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!frontendReady) throw new Error('Next.js frontend failed to start');
});

after(() => {
  frontendProcess?.kill();
  backendProcess?.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('BFF proxy security: direct backend access blocked without secret, BFF forwards properly', async () => {
  // Direct call to backend without secret should be 403 Forbidden
  const direct = await fetch(`${BACKEND_URL}/api/auth/status`);
  assert.equal(direct.status, 403);

  // Calling through Next.js /api/auth/status forwards with secret and succeeds
  const proxied = await bff('GET', '/api/auth/status', undefined, { auth: false });
  assert.equal(proxied.status, 200);
  assert.equal(proxied.data?.hasUsers, false);
});

test('First-run administrator sign-up through Next.js BFF and login sets session cookie', async () => {
  const signupRes = await bff('POST', '/api/auth/signup', {
    full_name: 'System Admin',
    username: 'admin',
    password: 'Password123!',
  }, { auth: false });

  assert.equal(signupRes.status, 201);
  assert.equal(signupRes.data?.first, true);

  // Status now shows users exist
  const statusRes = await bff('GET', '/api/auth/status', undefined, { auth: false });
  assert.equal(statusRes.data?.hasUsers, true);

  // Log in as the newly created administrator
  const loginRes = await bff('POST', '/api/auth/login', {
    username: 'admin',
    password: 'Password123!',
    remember: true,
  }, { auth: false });

  assert.ok(loginRes.status === 200 || loginRes.status === 201);
  assert.equal(loginRes.data?.user?.username, 'admin');

  // Next.js BFF forwards Set-Cookie header with psm_session
  const cookies = typeof loginRes.headers.getSetCookie === 'function'
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie')].filter(Boolean);
  const sessionPart = cookies.find((c) => c && c.startsWith('psm_session='));
  assert.ok(sessionPart, `psm_session cookie should be returned by BFF on login. Headers: ${JSON.stringify(cookies)}`);
  sessionCookie = sessionPart.split(';')[0];
  assert.ok(sessionCookie.length > 20);
});

test('Middleware page protection: unauthenticated requests redirect, authenticated succeed', async () => {
  // Without session cookie: accessing protected route redirects to login
  const unauth = await bff('GET', '/', undefined, { auth: false });
  assert.equal(unauth.status, 307);
  assert.ok(unauth.headers.get('location')?.includes('/login'));

  // With session cookie: accessing protected route succeeds with HTML
  const authed = await bff('GET', '/', undefined, { auth: true });
  assert.equal(authed.status, 200);
  assert.ok(typeof authed.data === 'string' && authed.data.includes('<!DOCTYPE html>'));

  // Main UI pages render properly with authenticated session
  const pages = [
    '/purchases',
    '/sales',
    '/inventory',
    '/vat',
    '/withholding',
    '/credit',
    '/parties',
    '/products',
    '/reconciliation',
    '/reports',
    '/settings',
  ];
  for (const page of pages) {
    const pageRes = await bff('GET', page, undefined, { auth: true });
    assert.equal(pageRes.status, 200, `Page ${page} should return 200 OK`);
  }
});

test('End-to-end data flow: Settings, Lookups, Products, Parties, Purchases, Sales', async () => {
  // 1. Session verification (/api/auth/me)
  const me = await bff('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data?.username, 'admin');

  // 2. Settings check & update
  const settings = await bff('GET', '/api/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.data?.company_name, 'Epiccenter Trading PLC');

  // 3. Lookups check
  const lookups = await bff('GET', '/api/lookups');
  assert.equal(lookups.status, 200);
  assert.ok(Array.isArray(lookups.data?.lists));
  assert.ok(Array.isArray(lookups.data?.values?.unit));

  // 4. Create Product
  const nextCode = await bff('GET', '/api/products/next-code');
  assert.equal(nextCode.status, 200);
  const prodCode = nextCode.data.code;

  const newProd = await bff('POST', '/api/products', {
    code: prodCode,
    name_en: 'Commercial Generator 50kVA',
    name_am: 'ጄኔሬተር 50kVA',
    category: 'Equipment',
    unit: 7,
    purchase_price: 250000,
    selling_price: 320000,
    track_stock: 1,
    min_stock: 2,
    opening_stock: 5,
  });
  assert.equal(newProd.status, 201, JSON.stringify(newProd.data));
  const prodId = newProd.data.id;

  // 5. Create Supplier Party
  const newSupplier = await bff('POST', '/api/parties', {
    name: 'Addis Industrial Supply PLC',
    type: 'Supplier',
    tin: '0012345678',
    vat_reg_no: 'VAT-998877',
    vat_rate: 0.15,
    payment_terms: 'Credit 30 Days',
  });
  assert.equal(newSupplier.status, 201, JSON.stringify(newSupplier.data));
  const supplierId = newSupplier.data.id;

  // 6. Record Purchase Invoice
  const nextPurchNo = await bff('GET', '/api/purchases/next-number');
  assert.equal(nextPurchNo.status, 200);

  const purchase = await bff('POST', '/api/purchases', {
    invoice_no: nextPurchNo.data.number,
    date: '2026-09-15',
    payment_type: 'Credit',
    vat_category: 'G',
    calendar_type: 'G',
    receipt_type: 'MRC',
    mrc_number: 'MRC-9876',
    vat_receipt_no: 'FS0001',
    party_id: supplierId,
    party_name: 'Addis Industrial Supply PLC',
    party_tin: '0012345678',
    lines: [
      {
        product_code: prodCode,
        description: 'Commercial Generator 50kVA',
        unit: 7,
        tx_type: 3,
        transaction_type: 'Vatable',
        qty: 3,
        unit_price: 250000,
      },
    ],
  });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.data));
  const purchId = purchase.data.id;

  // 7. Verify Purchases list through Next.js proxy
  const purchList = await bff('GET', '/api/purchases');
  assert.equal(purchList.status, 200);
  assert.ok(purchList.data?.some((p) => p.id === purchId));

  // 8. Withholding and Credit aging reports
  const whRes = await bff('GET', '/api/withholding/purchases');
  assert.equal(whRes.status, 200);

  const creditRes = await bff('GET', '/api/credit/purchases');
  assert.equal(creditRes.status, 200);
  assert.ok(Array.isArray(creditRes.data));
  assert.ok(creditRes.data.length > 0);
  assert.ok(creditRes.data[0].age_bucket !== undefined);

  // 9. Reconciliation summary
  const recSummary = await bff('GET', '/api/reconciliation/summary');
  assert.equal(recSummary.status, 200);
  assert.ok(recSummary.data?.debit !== undefined);
  assert.ok(recSummary.data?.credit !== undefined);
});

test('Binary Excel exports stream through Next.js BFF with valid headers', async () => {
  // Purchases Excel export
  const expPurch = await bff('GET', '/api/export/purchases');
  assert.equal(expPurch.status, 200);
  assert.ok(expPurch.headers.get('content-type')?.includes('spreadsheetml'));
  assert.ok(expPurch.data?.byteLength > 1000);

  // All-in-one Master workbook export
  const expAll = await bff('GET', '/api/export/all');
  assert.equal(expAll.status, 200);
  assert.ok(expAll.headers.get('content-type')?.includes('spreadsheetml'));
  assert.ok(expAll.data?.byteLength > 2000);

  // VAT Declaration Excel export
  const expVat = await bff('GET', '/api/export/vat');
  assert.equal(expVat.status, 200);
  assert.ok(expVat.headers.get('content-type')?.includes('spreadsheetml'));

  // Database backup download (admin only)
  const backup = await bff('GET', '/api/backup');
  assert.equal(backup.status, 200);
  assert.ok(backup.data?.byteLength > 5000);
});
