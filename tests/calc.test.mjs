// Pure tax / calendar rules (compiled from src/common/lib).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeLine, computeTotals, computeWithholding, receiptNumberError, DEFAULT_RULES } = require('../dist/common/lib/calc.js');
const { taxPeriod, toEthiopian, toGregorian } = require('../dist/common/lib/ethiopian.js');

test('line calculation matches workbook formulas (with taxable base fixed)', () => {
  const l = computeLine({ qty: 2, unit_price: 1000, excise_rate: 10, vatable_service_fee: 50, non_vatable_fee: 20, transaction_type: 'Vatable' });
  assert.equal(l.total, 2000);
  assert.equal(l.excise_amount, 200);
  assert.equal(l.taxable_amount, 2250);           // 2000 + 200 + 50
  assert.equal(l.vat_amount, 337.5);              // 15%
  assert.equal(l.line_total, 2607.5);             // 2250 + 337.5 + 20
  const exempt = computeLine({ qty: 1, unit_price: 100, transaction_type: 'Tax Exempt' });
  assert.equal(exempt.vat_amount, 0);
  assert.equal(computeTotals([l, exempt]).grand_total, 2707.5);
});

test('Purchase Declaration Format worked example', () => {
  const l = computeLine({ unit_price: 50, qty: 10, excise_rate: 10, vatable_service_fee: 20, non_vatable_fee: 10, transaction_type: 'Vatable' });
  assert.deepEqual([l.total, l.excise_amount, l.vat_amount, l.line_total], [500, 50, 85.5, 665.5]);
  assert.equal(computeLine({ unit_price: 50, qty: 10, transaction_type: 'Non-Vatable' }).vat_amount, 0);
});

test('withholding thresholds and rate', () => {
  assert.equal(computeWithholding({ taxable_amount: 20000, vat_category: 'G' }).status, 'No WH');
  const g = computeWithholding({ taxable_amount: 20001, vat_category: 'G', wh_receipt_type: 'With Receipt' });
  assert.equal(g.status, 'Goods WH');
  assert.equal(g.expected, 600.03);
  const s = computeWithholding({ taxable_amount: 10001, vat_category: 'S', wh_receipt_type: 'With Receipt', wh_paid: 100 });
  assert.equal(s.status, 'Service WH');
  assert.equal(s.outstanding, 200.03);
  assert.equal(computeWithholding({ taxable_amount: 50000, vat_category: 'G', wh_receipt_type: 'Without Receipt' }).expected, 0);
  assert.equal(DEFAULT_RULES.wh_rate, 0.03);
});

test('receipt number prefixes', () => {
  assert.equal(receiptNumberError('MRC', 'FS12345'), null);
  assert.match(receiptNumberError('MRC', '12345'), /start with “FS”/);
  assert.match(receiptNumberError('Manual', 'FS1'), /start with “M”/);
  assert.match(receiptNumberError('Manual', 'M'), /after “M”/);
});

test('Ethiopian months match the workbook date ranges', () => {
  const cases = [
    ['2026-07-08', 'Hamle'], ['2026-08-06', 'Hamle'], ['2026-08-07', 'Nehase'], ['2026-09-10', 'Nehase'],
    ['2026-09-11', 'Meskerem'], ['2026-10-11', 'Tikimt'], ['2026-12-10', 'Tahsas'], ['2027-02-08', 'Yekatit'],
    ['2027-06-08', 'Sene'], ['2027-07-07', 'Sene'],
  ];
  for (const [d, m] of cases) assert.equal(taxPeriod(d).month, m, d);
  assert.equal(taxPeriod('2026-07-08').fy, 2019);
  assert.equal(taxPeriod('2027-07-08').fy, 2020);
  assert.deepEqual(toEthiopian('2026-09-11'), { year: 2019, month: 1, day: 1 });
  assert.equal(toGregorian(2019, 13, 6), '2027-09-11'); // leap Pagume
  assert.equal(toGregorian(2018, 13, 6), null);
});
