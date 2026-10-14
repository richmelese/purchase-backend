import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { PartyEntity } from '../../entities/party.entity.js';
import { InvoiceEntity } from '../../entities/invoice.entity.js';
import { PaymentEntity } from '../../entities/payment.entity.js';
import { round2, computeWithholding, DEFAULT_RULES } from '../../common/lib/calc.js';
import { SettingsService } from '../settings/settings.service.js';
import { normalizeProfile, profileOptions, composeAddress } from '../settings/company-profile.service.js';
import { CompanyAccountsService } from './company-accounts.service.js';
import { allowedParties } from '../../common/permissions.js';

const str = (v: any) => (v == null ? '' : String(v).trim());

// The registration profile is only returned by GET /parties/:id, never in lists or lookups.
const withoutProfile = <T extends { profile?: any }>(row: T) => {
  if (!row) return row;
  const { profile, ...rest } = row;
  return { ...rest, has_profile: !!profile } as Omit<T, 'profile'> & { has_profile: boolean };
};

@Injectable()
export class PartiesService {
  constructor(
    @InjectRepository(PartyEntity) private readonly partyRepo: Repository<PartyEntity>,
    @InjectRepository(InvoiceEntity) private readonly invoiceRepo: Repository<InvoiceEntity>,
    @InjectRepository(PaymentEntity) private readonly paymentRepo: Repository<PaymentEntity>,
    private readonly settingsService: SettingsService,
    private readonly accounts: CompanyAccountsService,
  ) {}

  private validateParty(b: any) {
    const p = {
      tin: str(b.tin) || null,
      name: str(b.name),
      type: str(b.type) || 'Supplier',
      mrc1: str(b.mrc1) || null,
      mrc2: str(b.mrc2) || null,
      mrc3: str(b.mrc3) || null,
      phone: str(b.phone) || null,
      email: str(b.email) || null,
      address: str(b.address) || null,
    };
    const errors: Record<string, string> = {};
    let profile: string | undefined;
    if (b.profile && typeof b.profile === 'object') {
      // With a profile, contact details come from its address section (one source of truth).
      const { profile: doc, errors: profileErrors } = normalizeProfile(b.profile);
      for (const [k, v] of Object.entries(profileErrors)) errors[`profile.${k}`] = v;
      doc.general.company_name = p.name;
      doc.general.tin = p.tin || '';
      p.phone = doc.address.phone || null;
      p.email = doc.address.email || null;
      p.address = composeAddress(doc.address) || null;
      profile = JSON.stringify(doc);
    }
    if (!p.name) errors.name = 'Name is required';
    if (p.tin && !/^\d{1,15}$/.test(p.tin)) errors.tin = 'TIN must contain digits only';
    if (!['Supplier', 'Customer', 'Both'].includes(p.type)) errors.type = 'Invalid type';
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) errors.email = 'Invalid email';
    if (Object.keys(errors).length) {
      throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });
    }
    return { ...p, profile };
  }

  /** Creates the company's sign-in, or issues a new password for it. */
  public issueLogin(id: number) {
    return this.accounts.createOrReset(id);
  }

  /** Empty registration profile (with the fixed receipt rows) for the "New company" form. */
  public profileTemplate() {
    return { profile: normalizeProfile({}).profile, options: profileOptions() };
  }

  /** One company with its registration profile (pre-filled from the basic fields when not filled in yet). */
  public async getParty(id: number) {
    const party = await this.partyRepo.findById(id);
    if (!party) throw new NotFoundException('Company not found');
    let stored: any = null;
    try { stored = party.profile ? JSON.parse(party.profile) : null; } catch {}
    const seed = stored || {
      general: { company_name: party.name, tin: party.tin },
      address: { location: party.address, phone: party.phone, email: party.email },
    };
    const { profile } = normalizeProfile(seed);
    const login = this.accounts.getAccount(id);
    return { ...withoutProfile(party), login_username: login?.username || null, login_active: login ? !!login.active : null, profile, options: profileOptions() };
  }

  public async listParties(type?: string, q?: string, user?: any) {
    const where: string[] = [];
    const p: any = {};
    if (type) {
      where.push("(type = :type OR type = 'Both')");
      p.type = type;
    }
    if (q) {
      where.push('(name LIKE :q OR tin LIKE :q)');
      p.q = `%${q}%`;
    }
    if (user && !user.access_all_parties && Array.isArray(user.assigned_party_ids)) {
      if (user.assigned_party_ids.length === 0) {
        where.push('1 = 0');
      } else {
        const placeholders = user.assigned_party_ids.map((_: number, i: number) => `:pid_${i}`).join(',');
        where.push(`p.id IN (${placeholders})`);
        user.assigned_party_ids.forEach((id: number, i: number) => {
          p[`pid_${i}`] = id;
        });
      }
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `SELECT p.*,
      (SELECT COUNT(*) FROM invoices i WHERE i.party_id = p.id) AS invoice_count,
      (SELECT COALESCE(SUM(grand_total),0) FROM invoices i WHERE i.party_id = p.id AND i.kind='P') AS purchased,
      (SELECT COALESCE(SUM(grand_total),0) FROM invoices i WHERE i.party_id = p.id AND i.kind='S') AS sold,
      (SELECT username FROM users u WHERE u.party_id = p.id) AS login_username,
      (SELECT active FROM users u WHERE u.party_id = p.id) AS login_active
    FROM parties p ${whereClause} ORDER BY p.id`;

    return this.partyRepo.getDataSource().query(sql, p).map(withoutProfile);
  }

  public async getByTin(tin: string) {
    const party = await this.partyRepo.findOne({ where: { tin } });
    if (!party) throw new NotFoundException('No company with this TIN');
    return withoutProfile(party);
  }

  public async create(body: any, user?: any) {
    const p = this.validateParty(body);
    try {
      const { insertId } = await this.partyRepo.insert(p);
      // Every registered company gets its own sign-in (shown once to whoever registered it).
      // Someone restricted to some companies keeps access to the company they register.
      if (allowedParties(user) !== null) {
        this.partyRepo.getDataSource().execute('INSERT OR IGNORE INTO user_parties (user_id, party_id) VALUES (?, ?)', [user.id, insertId]);
      }
      const account = body.create_login === false ? null : this.accounts.createOrReset(insertId);
      return { ...withoutProfile(await this.partyRepo.findById(insertId)), account };
    } catch (e: any) {
      if (/UNIQUE/.test(e.message)) {
        throw new ConflictException({ message: 'A company with this TIN already exists', fields: { tin: 'Already exists' } });
      }
      throw e;
    }
  }

  public async update(id: number, body: any) {
    const p = this.validateParty(body);
    try {
      const res = await this.partyRepo.update(id, p);
      if (!res.affected) throw new NotFoundException('Not found');
    } catch (e: any) {
      if (/UNIQUE/.test(e.message)) {
        throw new ConflictException({ message: 'A company with this TIN already exists', fields: { tin: 'Already exists' } });
      }
      throw e;
    }

    const ds = this.partyRepo.getDataSource();
    ds.execute('UPDATE invoices SET party_name = ?, party_tin = ? WHERE party_id = ?', [p.name, p.tin, id]);
    ds.execute('UPDATE users SET full_name = ? WHERE party_id = ?', [p.name, id]);
    return withoutProfile(await this.partyRepo.findById(id));
  }

  public async delete(id: number) {
    // Its company login (and that login's sessions) go with it.
    this.partyRepo.getDataSource().execute('DELETE FROM users WHERE party_id = ?', [id]);
    await this.partyRepo.delete(id);
  }

  public async getStatement(partyId: number) {
    const party = await this.partyRepo.findById(partyId);
    if (!party) throw new NotFoundException('Company not found');

    const rules = await this.settingsService.getRules();
    const invoices = await this.invoiceRepo.find({ where: { party_id: party.id }, order: { date: 'ASC', id: 'ASC' } });
    const payments = this.partyRepo.getDataSource().query(
      `SELECT p.*, i.kind, i.invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.party_id = ? ORDER BY p.date, p.id`,
      [party.id],
    );

    const decoratedInvoices = invoices.map((inv) => {
      const wh = computeWithholding(inv, rules);
      const paidRow = this.partyRepo.getDataSource().queryOne<{ s: number }>(
        'SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?',
        [inv.id],
      );
      const due = round2(inv.grand_total - wh.expected);
      const paid = inv.payment_type === 'Cash' ? due : round2(paidRow?.s || 0);
      return { ...inv, wh, amount_due: due, amount_paid: paid, balance: round2(due - paid) };
    });

    const ledger = (kind: 'P' | 'S') => {
      const rows: any[] = [];
      for (const i of decoratedInvoices.filter((x) => x.kind === kind)) {
        rows.push({
          date: i.date,
          sort: `${i.date}-a-${i.id}`,
          type: kind === 'P' ? 'Purchase' : 'Sale',
          ref: i.invoice_no,
          invoice_id: i.id,
          detail: `${i.receipt_type} ${i.vat_receipt_no} · ${i.payment_type}${i.wh.expected ? ` · WH ${round2(i.wh.expected)}` : ''}`,
          charge: i.amount_due,
          payment: 0,
        });
        if (i.payment_type === 'Cash') {
          rows.push({
            date: i.date,
            sort: `${i.date}-b-${i.id}`,
            type: 'Cash payment',
            ref: i.invoice_no,
            invoice_id: i.id,
            detail: 'Settled in cash',
            charge: 0,
            payment: i.amount_due,
          });
        }
      }
      for (const p of payments.filter((x: any) => x.kind === kind)) {
        rows.push({
          date: p.date,
          sort: `${p.date}-c-${p.id}`,
          type: kind === 'P' ? 'Payment made' : 'Payment received',
          ref: p.invoice_no,
          invoice_id: p.invoice_id,
          detail: [p.method, p.reference].filter(Boolean).join(' · '),
          charge: 0,
          payment: p.amount,
        });
      }
      rows.sort((a, b) => (a.sort < b.sort ? -1 : 1));
      let bal = 0;
      for (const r of rows) {
        bal = round2(bal + r.charge - r.payment);
        r.balance = bal;
        delete r.sort;
      }
      return rows;
    };

    const sum = (kind: 'P' | 'S', f: (i: any) => number) =>
      round2(decoratedInvoices.filter((i) => i.kind === kind).reduce((a, i) => a + f(i), 0));

    return {
      party: withoutProfile(party),
      purchases: ledger('P'),
      sales: ledger('S'),
      totals: {
        purchased: sum('P', (i) => i.grand_total),
        purchaseCount: decoratedInvoices.filter((i) => i.kind === 'P').length,
        sold: sum('S', (i) => i.grand_total),
        saleCount: decoratedInvoices.filter((i) => i.kind === 'S').length,
        whWithheld: sum('P', (i) => i.wh.expected),
        whByCustomer: sum('S', (i) => i.wh.expected),
        payable: sum('P', (i) => i.balance),
        receivable: sum('S', (i) => i.balance),
      },
    };
  }
}
