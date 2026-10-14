import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from '../../orm/data-source.js';

// "Company Profile Other Detail Registration Format" (Form 00001): general information, address,
// contacts, licences, bank accounts and receipt requirements. Stored as one document in `settings`.
const KEY = 'company_profile';

export const ROUNDS = ['1st', '2nd', '3rd', '4th'];
export const BUSINESS_TYPES = ['PLC', 'SOL', 'SC', 'Other'];
export const MAX_LICENSES = 10;
export const MAX_BANKS = 12;
export const RECEIPT_TYPES = [
  'Cash Sales Invoice | VAT',
  'Credit Sales Invoice | VAT',
  'Withholding Tax on Payment',
  'Purchase Voucher (PV)',
  'Cash Receipt Voucher (CRV)',
  'Cheque Payment Voucher (CPV)',
  'Petty Cash Payment Voucher (PCPV)',
  'Goods Receiving Note (GRN)',
  'Stock Issue Note',
  'Journal Voucher',
  'Proforma Invoice',
  'Attachment (if receipt issue CRM)',
];
export const RECEIPT_STATUS_TYPES = RECEIPT_TYPES.slice(0, 5);
export const CONTACT_ROLES = [
  { key: 'owner', label: 'Owner' },
  { key: 'manager', label: 'General Manager / CEO' },
  { key: 'finance', label: 'Finance | Accountant' },
  { key: 'other', label: 'Other' },
];
const CHOICES = {
  requirement: ['Required', 'Not required'],
  print_status: ['Printed', 'Not printed'],
  current: ['Birhan & Selam', 'Old'],
  collection: ['Collected', 'Not collected'],
  old_void: ['Void', 'Not void'],
};

type Errors = Record<string, string>;

class Reader {
  errors: Errors = {};

  text(v: any, path: string, max = 200): string {
    const s = String(v ?? '').trim();
    if (s.length > max) this.errors[path] = `At most ${max} characters`;
    return s.slice(0, max);
  }
  digits(v: any, path: string, max = 20): string {
    const s = this.text(v, path, max).replace(/[\s-]/g, '');
    if (s && !/^\d+$/.test(s)) this.errors[path] = 'Numbers only';
    return s;
  }
  date(v: any, path: string): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) this.errors[path] = 'Invalid date';
    return s;
  }
  email(v: any, path: string): string {
    const s = this.text(v, path, 120);
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) this.errors[path] = 'Invalid e-mail address';
    return s;
  }
  count(v: any, path: string): number | null {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 9999) { this.errors[path] = 'Whole number of 0 or more'; return null; }
    return n;
  }
  choice(v: any, options: string[], path: string): string {
    const s = String(v ?? '').trim();
    if (s && !options.includes(s)) this.errors[path] = `Choose one of: ${options.join(', ')}`;
    return options.includes(s) ? s : '';
  }
  bool(v: any): boolean {
    return v === true || v === 1 || v === '1' || v === 'true';
  }
  yesNo(v: any): boolean | null {
    return v === null || v === undefined || v === '' ? null : this.bool(v);
  }
}

/** Validates and fills a profile document; unknown keys are dropped and fixed receipt rows always present. */
export function normalizeProfile(input: any) {
  const r = new Reader();
  const sec = (k: string) => (input?.[k] && typeof input[k] === 'object' ? input[k] : {});
  const round = (s: any, path: string) => r.choice(s.round, ROUNDS, `${path}.round`);

  const g0 = sec('general');
  const general = {
    round: round(g0, 'general'),
    company_name: r.text(g0.company_name, 'general.company_name'),
    tin: r.digits(g0.tin, 'general.tin', 13),
    tin_issue_date: r.date(g0.tin_issue_date, 'general.tin_issue_date'),
    vat_registered: r.yesNo(g0.vat_registered),
    vat_number: r.digits(g0.vat_number, 'general.vat_number', 20),
    vat_registration_date: r.date(g0.vat_registration_date, 'general.vat_registration_date'),
    tax_center: r.text(g0.tax_center, 'general.tax_center'),
    commercial_reg_no: r.text(g0.commercial_reg_no, 'general.commercial_reg_no', 60),
    commercial_reg_date: r.date(g0.commercial_reg_date, 'general.commercial_reg_date'),
    license_count: r.count(g0.license_count, 'general.license_count'),
    first_license_date: r.date(g0.first_license_date, 'general.first_license_date'),
    business_type: r.choice(g0.business_type, BUSINESS_TYPES, 'general.business_type'),
    business_type_other: r.text(g0.business_type_other, 'general.business_type_other', 80),
    tin_copy: r.bool(g0.tin_copy),
    vat_copy: r.bool(g0.vat_copy),
  };
  if (general.business_type !== 'Other') general.business_type_other = '';
  if (general.vat_registered === false) { general.vat_number = ''; general.vat_registration_date = ''; }

  const a0 = sec('address');
  const address = {
    round: round(a0, 'address'),
    region: r.text(a0.region, 'address.region', 80),
    zone: r.text(a0.zone, 'address.zone', 80),
    woreda: r.text(a0.woreda, 'address.woreda', 80),
    house_no: r.text(a0.house_no, 'address.house_no', 40),
    location: r.text(a0.location, 'address.location'),
    email: r.email(a0.email, 'address.email'),
    phone: r.text(a0.phone, 'address.phone', 30),
    phone2: r.text(a0.phone2, 'address.phone2', 30),
  };

  const c0 = sec('contacts');
  const contacts: any = { round: round(c0, 'contacts') };
  for (const { key } of CONTACT_ROLES) {
    const c = c0[key] && typeof c0[key] === 'object' ? c0[key] : {};
    const p = `contacts.${key}`;
    contacts[key] = {
      name: r.text(c.name, `${p}.name`, 120),
      email: r.email(c.email, `${p}.email`),
      phone: r.text(c.phone, `${p}.phone`, 30),
      phone2: r.text(c.phone2, `${p}.phone2`, 30),
      remark: r.text(c.remark, `${p}.remark`),
    };
    if (key === 'other') contacts.other.title = r.text(c.title, `${p}.title`, 80);
  }

  const l0 = sec('licenses');
  const licenseRows = (Array.isArray(l0.items) ? l0.items : []).slice(0, MAX_LICENSES);
  const licenses = {
    round: round(l0, 'licenses'),
    items: licenseRows.map((x: any, i: number) => ({
      license_no: r.text(x?.license_no, `licenses.items.${i}.license_no`, 60),
      field: r.text(x?.field, `licenses.items.${i}.field`),
      status: r.text(x?.status, `licenses.items.${i}.status`, 60),
      registration_date: r.date(x?.registration_date, `licenses.items.${i}.registration_date`),
    })).filter((x: any) => x.license_no || x.field || x.status || x.registration_date),
    commercial_certificate: r.bool(l0.commercial_certificate),
    license_total: r.count(l0.license_total, 'licenses.license_total'),
    license_collected: r.count(l0.license_collected, 'licenses.license_collected'),
  };

  const b0 = sec('banks');
  const bankRows = (Array.isArray(b0.items) ? b0.items : []).slice(0, MAX_BANKS);
  const banks = {
    round: round(b0, 'banks'),
    items: bankRows.map((x: any, i: number) => {
      const p = `banks.items.${i}`;
      const row = {
        bank_name: r.text(x?.bank_name, `${p}.bank_name`, 120),
        account_number: r.digits(x?.account_number, `${p}.account_number`, 30),
        opened: r.date(x?.opened, `${p}.opened`),
        closed: r.date(x?.closed, `${p}.closed`),
        branch: r.text(x?.branch, `${p}.branch`, 120),
      };
      if (row.opened && row.closed && row.closed < row.opened) r.errors[`${p}.closed`] = 'Cannot be before the opening date';
      if ((row.account_number || row.opened || row.closed || row.branch) && !row.bank_name) r.errors[`${p}.bank_name`] = 'Required';
      return row;
    }).filter((x: any) => x.bank_name || x.account_number || x.opened || x.closed || x.branch),
  };

  const rc0 = sec('receipts');
  const rcIn = Array.isArray(rc0.items) ? rc0.items : [];
  const receipts = {
    round: round(rc0, 'receipts'),
    items: RECEIPT_TYPES.map((type, i) => {
      const x = rcIn.find((y: any) => y?.type === type) || {};
      return {
        type,
        requirement: r.choice(x.requirement, CHOICES.requirement, `receipts.items.${i}.requirement`),
        print_status: r.choice(x.print_status, CHOICES.print_status, `receipts.items.${i}.print_status`),
      };
    }),
  };

  const rs0 = sec('receipt_status');
  const rsIn = Array.isArray(rs0.items) ? rs0.items : [];
  const receipt_status = {
    round: round(rs0, 'receipt_status'),
    items: RECEIPT_STATUS_TYPES.map((type, i) => {
      const x = rsIn.find((y: any) => y?.type === type) || {};
      const p = `receipt_status.items.${i}`;
      return {
        type,
        current: r.choice(x.current, CHOICES.current, `${p}.current`),
        collection: r.choice(x.collection, CHOICES.collection, `${p}.collection`),
        old_void: r.choice(x.old_void, CHOICES.old_void, `${p}.old_void`),
      };
    }),
    mor_old_ordered: r.count(rs0.mor_old_ordered, 'receipt_status.mor_old_ordered'),
    mor_old_collected: r.count(rs0.mor_old_collected, 'receipt_status.mor_old_collected'),
    mor_new_ordered: r.count(rs0.mor_new_ordered, 'receipt_status.mor_new_ordered'),
    mor_new_collected: r.count(rs0.mor_new_collected, 'receipt_status.mor_new_collected'),
  };
  for (const k of ['old', 'new']) {
    const o = (receipt_status as any)[`mor_${k}_ordered`];
    const c = (receipt_status as any)[`mor_${k}_collected`];
    if (o != null && c != null && c > o) r.errors[`receipt_status.mor_${k}_collected`] = 'More than ordered';
  }
  if (licenses.license_total != null && licenses.license_collected != null && licenses.license_collected > licenses.license_total) {
    r.errors['licenses.license_collected'] = 'More than the number of licences';
  }

  return {
    profile: { general, address, contacts, licenses, banks, receipts, receipt_status },
    errors: r.errors,
  };
}

export function profileOptions() {
  return { rounds: ROUNDS, business_types: BUSINESS_TYPES, contact_roles: CONTACT_ROLES, choices: CHOICES, max_licenses: MAX_LICENSES, max_banks: MAX_BANKS };
}

/** One-line address for invoices, statements and lists. */
export function composeAddress(a: { location?: string; house_no?: string; woreda?: string; zone?: string; region?: string }) {
  return [a.location, a.house_no && `H.No ${a.house_no}`, a.woreda && `Woreda ${a.woreda}`, a.zone, a.region].filter(Boolean).join(', ');
}

@Injectable()
export class CompanyProfileService {
  constructor(private readonly ds: DataSource) {}

  public getProfile() {
    const row = this.ds.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [KEY]);
    let stored: any = {};
    try { stored = row?.value ? JSON.parse(row.value) : {}; } catch {}
    if (!row?.value) {
      // First use: start from what Settings › Company already knows.
      const s = Object.fromEntries(this.ds.query<{ key: string; value: string }>(
        "SELECT key, value FROM settings WHERE key IN ('company_name', 'company_tin', 'company_address')",
      ).map((r) => [r.key, r.value]));
      stored = { general: { company_name: s.company_name, tin: s.company_tin }, address: { location: s.company_address } };
    }
    // Reading never fails: anything invalid in an old document is dropped rather than rejected.
    const { profile } = normalizeProfile(stored);
    return { ...profile, updated_at: stored.updated_at || null, updated_by: stored.updated_by || null };
  }

  public updateProfile(body: any, username?: string) {
    const { profile, errors } = normalizeProfile(body || {});
    if (!profile.general.company_name) errors['general.company_name'] = 'Required';
    if (Object.keys(errors).length) {
      throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });
    }
    const doc = { ...profile, updated_at: new Date().toISOString(), updated_by: username || null };
    const g = profile.general;
    const a = profile.address;
    const address = composeAddress(a);
    const upsert = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
    this.ds.transaction(() => {
      this.ds.execute(upsert, [KEY, JSON.stringify(doc)]);
      // Invoices, statements and the sidebar read these keys.
      this.ds.execute(upsert, ['company_name', g.company_name]);
      this.ds.execute(upsert, ['company_tin', g.tin]);
      if (address) this.ds.execute(upsert, ['company_address', address]);
    });
    return doc;
  }
}
