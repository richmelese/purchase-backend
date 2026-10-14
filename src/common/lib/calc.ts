// Ethiopian Tax Calculation Rules (VAT 15%, Withholding 3%, Excise Tax)
export const DEFAULT_RULES = {
  vat_rate: 0.15,
  wh_rate: 0.03,
  wh_goods_threshold: 20000,
  wh_service_threshold: 10000,
};

export const PAYMENT_TYPES = ['Cash', 'Credit'];
export const VAT_CATEGORIES = [
  { value: 'G', label: 'G – Goods' },
  { value: 'S', label: 'S – Service' },
];
export const CALENDAR_TYPES = [
  { value: 'E', label: 'E – Ethiopian' },
  { value: 'G', label: 'G – Gregorian' },
];
export const RECEIPT_TYPES = ['MRC', 'Manual', 'Electronics'];
export const UNITS = [
  { value: 2, label: 'KG' }, { value: 3, label: 'ML' }, { value: 4, label: 'GM' },
  { value: 5, label: 'LIT' }, { value: 6, label: 'MT' }, { value: 7, label: 'PCS' },
  { value: 8, label: 'CT' }, { value: 9, label: 'OTHER' }, { value: 10, label: 'PC' },
];
export const TRANSACTION_TYPES = ['Vatable', 'Non-Vatable', 'Zero Rated', 'Tax Exempt'];
export const PURCHASE_TAX_TYPES = ['Vatable', 'Non-Vatable'];

export const RECEIPT_PREFIX: Record<string, string> = { MRC: 'FS', Manual: 'M' };
export function receiptNumberError(receiptType: string, receiptNo: string): string | null {
  const prefix = RECEIPT_PREFIX[receiptType];
  if (!prefix || !receiptNo) return null;
  const no = String(receiptNo).toUpperCase();
  if (!no.startsWith(prefix)) return `${receiptType} receipt numbers must start with “${prefix}”`;
  if (no.length === prefix.length) return `Enter the receipt number after “${prefix}”`;
  return null;
}
export const REPORT_STATUSES = ['Not Reported', 'Reported'];
export const WH_RECEIPT_TYPES = ['With Receipt', 'Without Receipt', 'Government', 'Exempt'];

export const PURCHASE_TYPES = [
  { value: 1, label: 'Local Purchase Capital Asset', line: 65, tt: 'Vatable' },
  { value: 2, label: 'Imported Capital Asset', line: 75, tt: 'Vatable' },
  { value: 7, label: 'Purchase No VAT or Unclaimed Input (capital)', line: 85, tt: 'Non-Vatable' },
  { value: 3, label: 'Local Purchase Input', line: 100, tt: 'Vatable' },
  { value: 4, label: 'Imported Input', line: 110, tt: 'Vatable' },
  { value: 5, label: 'General Expense Input Purchase', line: 120, tt: 'Vatable' },
  { value: 6, label: 'Purchase No VAT or Unclaimed Input', line: 130, tt: 'Non-Vatable' },
];
export const SALES_TYPES = [
  { value: 1, label: 'Taxable sale', line: 5, tt: 'Vatable' },
  { value: 2, label: 'Zero-rated sale', line: 15, tt: 'Zero Rated' },
  { value: 3, label: 'Tax-exempt sale', line: 20, tt: 'Tax Exempt' },
];

export const typesFor = (kind: 'P' | 'S') => (kind === 'S' ? SALES_TYPES : PURCHASE_TYPES);
export const unitLabel = (v: number | string) => (UNITS.find((u) => u.value === +v) || {}).label || '';

export const round2 = (n: number | string) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
const num = (v: any) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function computeLine(line: any, rules = DEFAULT_RULES) {
  const qty = num(line.qty);
  const unit_price = num(line.unit_price);
  const excise_rate = num(line.excise_rate);
  const vatable_service_fee = num(line.vatable_service_fee);
  const non_vatable_fee = num(line.non_vatable_fee);
  const total = round2(qty * unit_price);
  const excise_amount = round2((total * excise_rate) / 100);
  const taxable_amount = round2(total + excise_amount + vatable_service_fee);
  const vat_amount = line.transaction_type === 'Vatable' ? round2(taxable_amount * rules.vat_rate) : 0;
  const line_total = round2(taxable_amount + vat_amount + non_vatable_fee);
  return {
    ...line,
    qty,
    unit_price,
    excise_rate,
    vatable_service_fee,
    non_vatable_fee,
    total,
    excise_amount,
    taxable_amount,
    vat_amount,
    line_total,
  };
}

export function computeTotals(lines: any[]) {
  const t = {
    total_amount: 0,
    excise_amount: 0,
    vatable_service_fee: 0,
    taxable_amount: 0,
    vat_amount: 0,
    non_vatable_fee: 0,
    grand_total: 0,
  };
  for (const l of lines) {
    t.total_amount += l.total;
    t.excise_amount += l.excise_amount;
    t.vatable_service_fee += l.vatable_service_fee;
    t.taxable_amount += l.taxable_amount;
    t.vat_amount += l.vat_amount;
    t.non_vatable_fee += l.non_vatable_fee;
    t.grand_total += l.line_total;
  }
  for (const k of Object.keys(t)) (t as any)[k] = round2((t as any)[k]);
  return t;
}

export function computeWithholding(inv: any, rules = DEFAULT_RULES) {
  const base = num(inv.taxable_amount);
  let status = 'No WH';
  if (base < 1) status = 'No Data';
  else if (inv.vat_category === 'G' && base > rules.wh_goods_threshold) status = 'Goods WH';
  else if (inv.vat_category === 'S' && base > rules.wh_service_threshold) status = 'Service WH';
  const applicable = status === 'Goods WH' || status === 'Service WH';
  const wh_base = applicable ? base : 0;
  const expected = applicable && inv.wh_receipt_type === 'With Receipt' ? round2(wh_base * rules.wh_rate) : 0;
  const paid = num(inv.wh_paid);
  return {
    status,
    applicable,
    base: wh_base,
    expected,
    paid,
    outstanding: round2(expected - paid),
  };
}
