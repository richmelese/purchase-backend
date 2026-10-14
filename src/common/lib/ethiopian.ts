export const EC_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
];

export const FY_MONTHS = [
  'Hamle', 'Nehase', 'Meskerem', 'Tikimt', 'Hidar', 'Tahsas',
  'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene',
];

const EC_EPOCH = 1723856;

function gregorianToJdn(y: number, m: number, d: number) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdnToGregorian(jdn: number) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

function ethiopianToJdn(y: number, m: number, d: number) {
  return EC_EPOCH + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * m + d - 31;
}

function jdnToEthiopian(jdn: number) {
  const r = (jdn - EC_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - EC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

function parseIso(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toEthiopian(iso: string) {
  const g = parseIso(iso);
  if (!g) return null;
  return jdnToEthiopian(gregorianToJdn(g.year, g.month, g.day));
}

export function toGregorian(year: number, month: number, day: number) {
  year = +year; month = +month; day = +day;
  if (!year || month < 1 || month > 13 || day < 1) return null;
  const maxDay = month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
  if (day > maxDay) return null;
  const g = jdnToGregorian(ethiopianToJdn(year, month, day));
  return `${g.year}-${pad(g.month)}-${pad(g.day)}`;
}

export function formatEthiopian(iso: string) {
  const e = toEthiopian(iso);
  return e ? `${e.day} ${EC_MONTHS[e.month - 1]} ${e.year}` : '';
}

export function taxPeriod(iso: string) {
  const e = toEthiopian(iso);
  if (!e) return null;
  const m = e.month === 13 ? 12 : e.month;
  const fy = m >= 11 ? e.year + 1 : e.year;
  const idx = m >= 11 ? m - 11 : m + 1;
  return { fy, idx, month: FY_MONTHS[idx], ecYear: e.year };
}

export function currentFiscalYear(): number {
  const today = new Date().toISOString().slice(0, 10);
  return taxPeriod(today)?.fy || 2019;
}

export const fiscalYearLabel = (fy: number) => `Hamle ${fy - 1} – Sene ${fy} EC`;
