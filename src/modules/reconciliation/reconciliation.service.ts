import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { BankAccountEntity } from '../../entities/bank-account.entity.js';
import { BankTransactionEntity } from '../../entities/bank-transaction.entity.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { round2 } from '../../common/lib/calc.js';
import ExcelJS from 'exceljs';

const MONEY = '#,##0.00;[Red]-#,##0.00';
const HEADER_FILL: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };

export function normalizeCode(code: any): string {
  if (!code) return '';
  const s = String(code).trim().toUpperCase();
  const m = s.match(/^([PS])0*(\d+)$/);
  if (m) {
    return `${m[1]}${String(m[2]).padStart(4, '0')}`;
  }
  return s;
}

export function codesMatch(a: any, b: any): boolean {
  if (!a || !b) return false;
  return normalizeCode(a) === normalizeCode(b);
}

@Injectable()
export class ReconciliationService {
  constructor(
    @InjectRepository(BankAccountEntity) private readonly accountRepo: Repository<BankAccountEntity>,
    @InjectRepository(BankTransactionEntity) private readonly txRepo: Repository<BankTransactionEntity>,
    private readonly invoicesService: InvoicesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Bank Accounts
  // ---------------------------------------------------------------------------
  public async listBankAccounts() {
    const ds = this.accountRepo.getDataSource();
    const rows = ds.query(`
      SELECT a.*,
        COALESCE(SUM(t.debit), 0) AS total_debit,
        COALESCE(SUM(t.credit), 0) AS total_credit,
        COUNT(t.id) AS tx_count
      FROM bank_accounts a
      LEFT JOIN bank_transactions t ON t.bank_account_id = a.id
      GROUP BY a.id
      ORDER BY a.account_no ASC
    `);

    return rows.map((a: any) => {
      const opening = Number(a.opening_balance || 0);
      const debit = Number(a.total_debit || 0);
      const credit = Number(a.total_credit || 0);
      const balance = round2(opening + credit - debit);
      return {
        ...a,
        opening_balance: opening,
        total_debit: debit,
        total_credit: credit,
        current_balance: balance,
      };
    });
  }

  public async getBankAccount(id: number) {
    const acc = await this.accountRepo.findOne({ where: { id } });
    if (!acc) throw new NotFoundException('Bank account not found');
    return acc;
  }

  public async saveBankAccount(input: any) {
    const accountNo = Number(input.account_no);
    if (!accountNo || accountNo < 1) throw new BadRequestException('Valid account number is required');
    const bankName = String(input.bank_name || '').trim();
    if (!bankName) throw new BadRequestException('Bank name is required');
    const accountName = String(input.account_name || `Bank ${String(accountNo).padStart(2, '0')}`).trim();

    const existing = await this.accountRepo.findOne({ where: { account_no: accountNo } });
    if (existing) throw new ConflictException(`Account number ${accountNo} already exists`);

    const result = await this.accountRepo.insert({
      account_no: accountNo,
      bank_name: bankName,
      account_name: accountName,
      account_number: input.account_number ? String(input.account_number).trim() : null,
      currency: input.currency ? String(input.currency).trim() : 'ETB',
      opening_balance: Number(input.opening_balance || 0),
      notes: input.notes ? String(input.notes).trim() : null,
    });

    return this.getBankAccount(Number(result.insertId));
  }

  public async updateBankAccount(id: number, input: any) {
    const acc = await this.getBankAccount(id);
    await this.accountRepo.update(id, {
      bank_name: input.bank_name !== undefined ? String(input.bank_name).trim() : acc.bank_name,
      account_name: input.account_name !== undefined ? String(input.account_name).trim() : acc.account_name,
      account_number: input.account_number !== undefined ? String(input.account_number).trim() : acc.account_number,
      currency: input.currency !== undefined ? String(input.currency).trim() : acc.currency,
      opening_balance: input.opening_balance !== undefined ? Number(input.opening_balance || 0) : acc.opening_balance,
      notes: input.notes !== undefined ? String(input.notes).trim() : acc.notes,
    });
    return this.getBankAccount(id);
  }

  public async deleteBankAccount(id: number) {
    await this.getBankAccount(id);
    const ds = this.accountRepo.getDataSource();
    const count = ds.queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM bank_transactions WHERE bank_account_id = ?', [id]);
    if (count && count.c > 0) {
      throw new BadRequestException(`Cannot delete account with ${count.c} existing transactions`);
    }
    await this.accountRepo.delete(id);
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  public getInvoiceExpected(invoiceNo: string, kind: 'P' | 'S' | null = null): number {
    if (!invoiceNo) return 0;
    const ds = this.accountRepo.getDataSource();
    const norm = normalizeCode(invoiceNo);
    let inv = ds.queryOne('SELECT * FROM invoices WHERE invoice_no = ?', [norm]);
    if (!inv) inv = ds.queryOne('SELECT * FROM invoices WHERE invoice_no = ?', [invoiceNo]);
    if (!inv) return 0;
    if (kind && inv.kind !== kind) return 0;

    if (inv.kind === 'P') {
      const wh = Number(inv.wh_paid || inv.wh_amount || 0);
      return round2((inv.grand_total || 0) - wh);
    }
    const wh = Number(inv.wh_amount || 0);
    return round2((inv.grand_total || 0) - wh);
  }

  // ---------------------------------------------------------------------------
  // Bank Transactions
  // ---------------------------------------------------------------------------
  public async nextBankCode(bankAccountId: number) {
    const acc = await this.getBankAccount(bankAccountId);
    const ds = this.accountRepo.getDataSource();
    const max = ds.queryOne<{ m: number }>('SELECT MAX(row_no) AS m FROM bank_transactions WHERE bank_account_id = ?', [bankAccountId]);
    const nextRow = (max?.m || 0) + 1;
    const code = `${acc.bank_name}${String(nextRow).padStart(3, '0')}`;
    return { next_row_no: nextRow, next_bank_code: code, bank_name: acc.bank_name };
  }

  public async listBankTransactions({ bank_account_id, search, limit = 200, offset = 0 }: any = {}) {
    const ds = this.accountRepo.getDataSource();
    let sql = `
      SELECT t.*, a.bank_name, a.account_name, a.account_no
      FROM bank_transactions t
      JOIN bank_accounts a ON a.id = t.bank_account_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (bank_account_id) {
      sql += ' AND t.bank_account_id = ?';
      params.push(bank_account_id);
    }

    if (search) {
      sql += ' AND (t.bank_code LIKE ? OR t.purchase_code_1 LIKE ? OR t.purchase_code_2 LIKE ? OR t.sales_code_1 LIKE ? OR t.sales_code_2 LIKE ? OR t.purchase_remark LIKE ? OR t.sales_remark LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q, q, q, q, q);
    }

    sql += ' ORDER BY a.account_no ASC, t.row_no ASC';
    if (limit) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(Number(limit), Number(offset));
    }

    const rows = ds.query(sql, params);

    return rows.map((r: any) => {
      const p1Exp = this.getInvoiceExpected(r.purchase_code_1, 'P');
      const p2Exp = this.getInvoiceExpected(r.purchase_code_2, 'P');
      const pExpected = round2(p1Exp + p2Exp);
      const pDiff = round2((r.debit || 0) - pExpected);

      const s1Exp = this.getInvoiceExpected(r.sales_code_1, 'S');
      const s2Exp = this.getInvoiceExpected(r.sales_code_2, 'S');
      const sExpected = round2(s1Exp + s2Exp);
      const sDiff = round2((r.credit || 0) - sExpected);

      return {
        ...r,
        purchase_expected: pExpected,
        purchase_difference: pDiff,
        purchase_reconciled: r.debit > 0 && Math.abs(pDiff) < 0.01,
        sales_expected: sExpected,
        sales_difference: sDiff,
        sales_reconciled: r.credit > 0 && Math.abs(sDiff) < 0.01,
      };
    });
  }

  public async saveBankTransaction(input: any) {
    const bankAccountId = Number(input.bank_account_id);
    if (!bankAccountId) throw new BadRequestException('Bank account ID is required');
    const acc = await this.getBankAccount(bankAccountId);

    let rowNo = Number(input.row_no);
    if (!rowNo || rowNo < 1) {
      const next = await this.nextBankCode(bankAccountId);
      rowNo = next.next_row_no;
    }

    let bankCode = String(input.bank_code || '').trim();
    if (!bankCode) {
      bankCode = `${acc.bank_name}${String(rowNo).padStart(3, '0')}`;
    }

    const result = await this.txRepo.insert({
      bank_account_id: bankAccountId,
      row_no: rowNo,
      bank_code: bankCode,
      value_date: input.value_date ? String(input.value_date).trim() : null,
      purchase_code_1: input.purchase_code_1 ? normalizeCode(input.purchase_code_1) : null,
      purchase_code_2: input.purchase_code_2 ? normalizeCode(input.purchase_code_2) : null,
      debit: Number(input.debit || 0),
      purchase_remark: input.purchase_remark ? String(input.purchase_remark).trim() : null,
      sales_code_1: input.sales_code_1 ? normalizeCode(input.sales_code_1) : null,
      sales_code_2: input.sales_code_2 ? normalizeCode(input.sales_code_2) : null,
      credit: Number(input.credit || 0),
      sales_remark: input.sales_remark ? String(input.sales_remark).trim() : null,
    });

    return this.txRepo.findOne({ where: { id: Number(result.insertId) } });
  }

  public async updateBankTransaction(id: number, input: any) {
    const tx = await this.txRepo.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.txRepo.update(id, {
      bank_account_id: input.bank_account_id !== undefined ? Number(input.bank_account_id) : tx.bank_account_id,
      row_no: input.row_no !== undefined ? Number(input.row_no) : tx.row_no,
      bank_code: input.bank_code !== undefined ? String(input.bank_code).trim() : tx.bank_code,
      value_date: input.value_date !== undefined ? (input.value_date ? String(input.value_date).trim() : null) : tx.value_date,
      purchase_code_1: input.purchase_code_1 !== undefined ? (input.purchase_code_1 ? normalizeCode(input.purchase_code_1) : null) : tx.purchase_code_1,
      purchase_code_2: input.purchase_code_2 !== undefined ? (input.purchase_code_2 ? normalizeCode(input.purchase_code_2) : null) : tx.purchase_code_2,
      debit: input.debit !== undefined ? Number(input.debit || 0) : tx.debit,
      purchase_remark: input.purchase_remark !== undefined ? (input.purchase_remark ? String(input.purchase_remark).trim() : null) : tx.purchase_remark,
      sales_code_1: input.sales_code_1 !== undefined ? (input.sales_code_1 ? normalizeCode(input.sales_code_1) : null) : tx.sales_code_1,
      sales_code_2: input.sales_code_2 !== undefined ? (input.sales_code_2 ? normalizeCode(input.sales_code_2) : null) : tx.sales_code_2,
      credit: input.credit !== undefined ? Number(input.credit || 0) : tx.credit,
      sales_remark: input.sales_remark !== undefined ? (input.sales_remark ? String(input.sales_remark).trim() : null) : tx.sales_remark,
    });

    return this.txRepo.findOne({ where: { id } });
  }

  public async deleteBankTransaction(id: number) {
    const tx = await this.txRepo.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    await this.txRepo.delete(id);
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Purchases Reconciliation View
  // ---------------------------------------------------------------------------
  public async getPurchasesReconciliation({ status = 'all', search = '' }: any = {}) {
    const purchases = await this.invoicesService.listInvoices({ kind: 'P' });
    const ds = this.accountRepo.getDataSource();
    const allTx = ds.query(`
      SELECT t.*, a.bank_name, a.account_name, a.account_no
      FROM bank_transactions t
      JOIN bank_accounts a ON a.id = t.bank_account_id
      WHERE t.purchase_code_1 IS NOT NULL OR t.purchase_code_2 IS NOT NULL
    `);

    const results = purchases.map((p: any, idx: number) => {
      const norm = normalizeCode(p.invoice_no);
      const matched = allTx.filter((t: any) => codesMatch(t.purchase_code_1, norm) || codesMatch(t.purchase_code_2, norm));

      const wh = Number(p.wh_paid || p.wh_amount || 0);
      const expected = round2((p.grand_total || 0) - wh);
      const bankAmt = round2(matched.reduce((acc: number, t: any) => acc + (t.debit || 0), 0));
      const diff = round2(expected - bankAmt);

      let recStatus = 'Unreconciled';
      if (bankAmt > 0 && Math.abs(diff) < 0.01) recStatus = 'Reconciled';
      else if (bankAmt > 0 && diff > 0) recStatus = 'Partial';
      else if (diff < -0.01) recStatus = 'Overpaid';

      const bankCodes = matched.map((t: any) => t.bank_code);
      const bankNames = [...new Set(matched.map((t: any) => t.bank_name))];

      return {
        no: idx + 1,
        id: p.id,
        invoice_no: p.invoice_no,
        date: p.date,
        party_name: p.party_name,
        party_tin: p.party_tin,
        receipt_no: p.vat_receipt_no || p.receipt_no,
        payment_type: p.payment_type,
        total_before_vat: p.taxable_amount,
        vat_amount: p.vat_amount,
        grand_total: p.grand_total,
        withholding: wh,
        vat_withholding: 0,
        expected_payment: expected,
        amount_in_bank: bankAmt,
        difference: diff,
        status: recStatus,
        bank_codes: bankCodes,
        bank_code_1: bankCodes[0] || '',
        bank_code_2: bankCodes[1] || '',
        bank_names: bankNames,
        matched_transactions: matched,
      };
    });

    return results.filter((r: any) => {
      if (status !== 'all' && r.status.toLowerCase() !== status.toLowerCase()) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.invoice_no.toLowerCase().includes(q) ||
          (r.party_name && r.party_name.toLowerCase().includes(q)) ||
          (r.party_tin && r.party_tin.includes(q)) ||
          r.bank_codes.some((bc: string) => bc.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Sales Reconciliation View
  // ---------------------------------------------------------------------------
  public async getSalesReconciliation({ status = 'all', search = '' }: any = {}) {
    const sales = await this.invoicesService.listInvoices({ kind: 'S' });
    const ds = this.accountRepo.getDataSource();
    const allTx = ds.query(`
      SELECT t.*, a.bank_name, a.account_name, a.account_no
      FROM bank_transactions t
      JOIN bank_accounts a ON a.id = t.bank_account_id
      WHERE t.sales_code_1 IS NOT NULL OR t.sales_code_2 IS NOT NULL
    `);

    const results = sales.map((s: any, idx: number) => {
      const norm = normalizeCode(s.invoice_no);
      const matched = allTx.filter((t: any) => codesMatch(t.sales_code_1, norm) || codesMatch(t.sales_code_2, norm));

      const wh = Number(s.wh_amount || 0);
      const expected = round2((s.grand_total || 0) - wh);
      const bankAmt = round2(matched.reduce((acc: number, t: any) => acc + (t.credit || 0), 0));
      const diff = round2(expected - bankAmt);

      let recStatus = 'Unreconciled';
      if (bankAmt > 0 && Math.abs(diff) < 0.01) recStatus = 'Reconciled';
      else if (bankAmt > 0 && diff > 0) recStatus = 'Partial';
      else if (diff < -0.01) recStatus = 'Overcollected';

      const bankCodes = matched.map((t: any) => t.bank_code);
      const bankNames = [...new Set(matched.map((t: any) => t.bank_name))];

      return {
        no: idx + 1,
        id: s.id,
        invoice_no: s.invoice_no,
        date: s.date,
        party_name: s.party_name,
        party_tin: s.party_tin,
        receipt_no: s.vat_receipt_no || s.receipt_no,
        payment_type: s.payment_type,
        total_before_vat: s.taxable_amount,
        vat_amount: s.vat_amount,
        grand_total: s.grand_total,
        withholding: wh,
        expected_payment: expected,
        amount_in_bank: bankAmt,
        difference: diff,
        status: recStatus,
        bank_codes: bankCodes,
        bank_code_1: bankCodes[0] || '',
        bank_code_2: bankCodes[1] || '',
        bank_names: bankNames,
        matched_transactions: matched,
      };
    });

    return results.filter((r: any) => {
      if (status !== 'all' && r.status.toLowerCase() !== status.toLowerCase()) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.invoice_no.toLowerCase().includes(q) ||
          (r.party_name && r.party_name.toLowerCase().includes(q)) ||
          (r.party_tin && r.party_tin.includes(q)) ||
          r.bank_codes.some((bc: string) => bc.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  public async getReconciliationSummary() {
    const accounts = await this.listBankAccounts();
    const purchasesRec = await this.getPurchasesReconciliation();
    const salesRec = await this.getSalesReconciliation();

    const totalBankDebit = round2(accounts.reduce((acc: number, a: any) => acc + a.total_debit, 0));
    const expectedPurchases = round2(purchasesRec.reduce((acc: number, p: any) => acc + p.expected_payment, 0));
    const debitVariance = round2(totalBankDebit - expectedPurchases);

    const totalBankCredit = round2(accounts.reduce((acc: number, a: any) => acc + a.total_credit, 0));
    const expectedSales = round2(salesRec.reduce((acc: number, s: any) => acc + s.expected_payment, 0));
    const creditVariance = round2(totalBankCredit - expectedSales);

    const totalBalance = round2(accounts.reduce((acc: number, a: any) => acc + a.current_balance, 0));

    const pReconciledCount = purchasesRec.filter((p: any) => p.status === 'Reconciled').length;
    const sReconciledCount = salesRec.filter((s: any) => s.status === 'Reconciled').length;

    return {
      accounts,
      total_balance: totalBalance,
      debit: {
        total_bank_debit: totalBankDebit,
        expected_purchases: expectedPurchases,
        variance: debitVariance,
        purchases_count: purchasesRec.length,
        reconciled_count: pReconciledCount,
        unreconciled_count: purchasesRec.length - pReconciledCount,
        reconciliation_rate: purchasesRec.length ? Math.round((pReconciledCount / purchasesRec.length) * 100) : 0,
      },
      credit: {
        total_bank_credit: totalBankCredit,
        expected_sales: expectedSales,
        variance: creditVariance,
        sales_count: salesRec.length,
        reconciled_count: sReconciledCount,
        unreconciled_count: salesRec.length - sReconciledCount,
        reconciliation_rate: salesRec.length ? Math.round((sReconciledCount / salesRec.length) * 100) : 0,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Auto-Match
  // ---------------------------------------------------------------------------
  public async autoMatchTransactions() {
    const ds = this.accountRepo.getDataSource();
    return ds.transaction(() => {
      let matchedPurchases = 0;
      let matchedSales = 0;
      const details: any[] = [];

      const unlinkedDebits = ds.query(`
        SELECT * FROM bank_transactions
        WHERE debit > 0 AND (purchase_code_1 IS NULL OR purchase_code_1 = '')
      `);

      const purchases = ds.query("SELECT * FROM invoices WHERE kind = 'P'");

      for (const tx of unlinkedDebits) {
        const candidate = purchases.find((p: any) => {
          const exp = round2((p.grand_total || 0) - Number(p.wh_paid || p.wh_amount || 0));
          return Math.abs(exp - tx.debit) < 0.01;
        });
        if (candidate) {
          ds.execute('UPDATE bank_transactions SET purchase_code_1 = ? WHERE id = ?', [candidate.invoice_no, tx.id]);
          matchedPurchases++;
          details.push({ type: 'Purchase', transaction_id: tx.id, bank_code: tx.bank_code, invoice_no: candidate.invoice_no, amount: tx.debit });
        }
      }

      const unlinkedCredits = ds.query(`
        SELECT * FROM bank_transactions
        WHERE credit > 0 AND (sales_code_1 IS NULL OR sales_code_1 = '')
      `);

      const sales = ds.query("SELECT * FROM invoices WHERE kind = 'S'");

      for (const tx of unlinkedCredits) {
        const candidate = sales.find((s: any) => {
          const exp = round2((s.grand_total || 0) - Number(s.wh_amount || 0));
          return Math.abs(exp - tx.credit) < 0.01;
        });
        if (candidate) {
          ds.execute('UPDATE bank_transactions SET sales_code_1 = ? WHERE id = ?', [candidate.invoice_no, tx.id]);
          matchedSales++;
          details.push({ type: 'Sale', transaction_id: tx.id, bank_code: tx.bank_code, invoice_no: candidate.invoice_no, amount: tx.credit });
        }
      }

      return { matched_purchases: matchedPurchases, matched_sales: matchedSales, total_matched: matchedPurchases + matchedSales, details };
    });
  }

  // ---------------------------------------------------------------------------
  // Excel Import
  // ---------------------------------------------------------------------------
  public async importReconciliationWorkbook(fileInput: any) {
    const wb = new ExcelJS.Workbook();
    if (typeof fileInput === 'string') {
      await wb.xlsx.readFile(fileInput);
    } else if (fileInput && typeof fileInput === 'object' && fileInput.filePath) {
      await wb.xlsx.readFile(fileInput.filePath);
    } else {
      await wb.xlsx.load(fileInput);
    }

    const ds = this.accountRepo.getDataSource();
    return ds.transaction(() => {
      let importedTotal = 0;
      const accountStats: any = {};

      for (let accNo = 1; accNo <= 10; accNo++) {
        const sheetName = `Bank ${String(accNo).padStart(2, '0')}`;
        const ws = wb.getWorksheet(sheetName);
        if (!ws) continue;

        let acc = ds.queryOne('SELECT * FROM bank_accounts WHERE account_no = ?', [accNo]);
        if (!acc) {
          const bName = ws.getCell('C2').value || 'CBE';
          const info = ds.execute('INSERT INTO bank_accounts (account_no, bank_name, account_name) VALUES (?, ?, ?)', [
            accNo,
            String(bName).trim(),
            sheetName,
          ]);
          acc = ds.queryOne('SELECT * FROM bank_accounts WHERE id = ?', [info.lastInsertRowid]);
        }

        let count = 0;
        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber === 1) return;

          const getVal = (col: number) => {
            const c: any = row.getCell(col).value;
            if (c == null) return null;
            if (typeof c === 'object') {
              if ('result' in c) return c.result;
              if (c.text) return c.text;
              if (c.richText) return c.richText.map((t: any) => t.text).join('');
              if (c instanceof Date) return c.toISOString().split('T')[0];
            }
            return c;
          };

          const bankCode = getVal(2) || getVal(20);
          const p1 = getVal(4);
          const p2 = getVal(5);
          const debit = Number(getVal(6) || 0);
          const pRemark = getVal(9);
          const s1 = getVal(10);
          const s2 = getVal(11);
          const credit = Number(getVal(12) || 0);
          const sRemark = getVal(15);
          let valDate: any = getVal(16);
          if (valDate instanceof Date) valDate = valDate.toISOString().split('T')[0];

          if (!bankCode && !p1 && !s1 && debit === 0 && credit === 0) return;

          const effectiveCode = String(bankCode || `${acc.bank_name}${String(rowNumber - 1).padStart(3, '0')}`).trim();

          const existing = ds.queryOne(
            'SELECT id FROM bank_transactions WHERE bank_account_id = ? AND (row_no = ? OR bank_code = ?)',
            [acc.id, rowNumber - 1, effectiveCode],
          );

          if (existing) {
            ds.execute(
              `UPDATE bank_transactions
               SET bank_code = ?, value_date = ?, purchase_code_1 = ?, purchase_code_2 = ?, debit = ?, purchase_remark = ?,
                   sales_code_1 = ?, sales_code_2 = ?, credit = ?, sales_remark = ?, updated_at = datetime('now')
               WHERE id = ?`,
              [
                effectiveCode,
                valDate ? String(valDate) : null,
                p1 ? normalizeCode(p1) : null,
                p2 ? normalizeCode(p2) : null,
                debit,
                pRemark ? String(pRemark) : null,
                s1 ? normalizeCode(s1) : null,
                s2 ? normalizeCode(s2) : null,
                credit,
                sRemark ? String(sRemark) : null,
                existing.id,
              ],
            );
          } else {
            ds.execute(
              `INSERT INTO bank_transactions
                 (bank_account_id, row_no, bank_code, value_date, purchase_code_1, purchase_code_2, debit, purchase_remark,
                  sales_code_1, sales_code_2, credit, sales_remark)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                acc.id,
                rowNumber - 1,
                effectiveCode,
                valDate ? String(valDate) : null,
                p1 ? normalizeCode(p1) : null,
                p2 ? normalizeCode(p2) : null,
                debit,
                pRemark ? String(pRemark) : null,
                s1 ? normalizeCode(s1) : null,
                s2 ? normalizeCode(s2) : null,
                credit,
                sRemark ? String(sRemark) : null,
              ],
            );
          }
          count++;
          importedTotal++;
        });

        accountStats[sheetName] = count;
      }

      return { total_imported: importedTotal, account_stats: accountStats };
    });
  }

  // ---------------------------------------------------------------------------
  // Excel Export
  // ---------------------------------------------------------------------------
  public async exportReconciliationWorkbook() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Purchase & Sales Management';
    wb.created = new Date();

    const accounts = await this.listBankAccounts();
    const purchases = await this.getPurchasesReconciliation();
    const sales = await this.getSalesReconciliation();
    const ds = this.accountRepo.getDataSource();

    // 1. Menu Sheet
    const wsMenu = wb.addWorksheet('Menu');
    wsMenu.columns = [
      { header: 'No', key: 'no', width: 8 },
      { header: 'Short Name', key: 'short', width: 14 },
      { header: 'Full Name', key: 'full', width: 36 },
      { header: 'Type / Note', key: 'note', width: 30 },
    ];
    wsMenu.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsMenu.getRow(1).fill = HEADER_FILL;

    const banks = ds.query("SELECT * FROM lookups WHERE list = 'bank' ORDER BY sort ASC");
    banks.forEach((b: any, i: number) => {
      wsMenu.addRow([i + 1, b.value, b.label, '']);
    });

    // 2. Sales Sheet
    const wsSales = wb.addWorksheet('Sales', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsSales.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Sales Code', key: 'code', width: 14 },
      { header: 'Bank Code 1', key: 'b1', width: 14 },
      { header: 'Bank Code 2', key: 'b2', width: 14 },
      { header: 'TIN', key: 'tin', width: 14 },
      { header: 'Company Name', key: 'name', width: 28 },
      { header: 'Receipt Number', key: 'rcpt', width: 16 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Total Price Before VAT', key: 'taxable', width: 20 },
      { header: 'VAT (15%)', key: 'vat', width: 14 },
      { header: 'Total Price', key: 'total', width: 16 },
      { header: 'Withholding', key: 'wh', width: 14 },
      { header: 'Expected Payment @ Bank', key: 'exp', width: 22 },
      { header: 'Amount In Bank', key: 'bank_amt', width: 18 },
      { header: 'Difference', key: 'diff', width: 14 },
      { header: 'Remark', key: 'remark', width: 16 },
    ];
    wsSales.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsSales.getRow(1).fill = HEADER_FILL;

    sales.forEach((s: any) => {
      const row = wsSales.addRow([
        s.no,
        s.invoice_no,
        s.bank_code_1,
        s.bank_code_2,
        s.party_tin || '',
        s.party_name || '',
        s.receipt_no || '',
        s.date || '',
        s.total_before_vat,
        s.vat_amount,
        s.grand_total,
        s.withholding,
        s.expected_payment,
        s.amount_in_bank,
        s.difference,
        s.status,
      ]);
      [9, 10, 11, 12, 13, 14, 15].forEach((ci) => {
        row.getCell(ci).numFmt = MONEY;
      });
    });

    // 3. Purchase Sheet
    const wsPur = wb.addWorksheet('Purchase', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsPur.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Purchase Code', key: 'code', width: 14 },
      { header: 'Bank Code 1', key: 'b1', width: 14 },
      { header: 'Bank Code 2', key: 'b2', width: 14 },
      { header: 'TIN', key: 'tin', width: 14 },
      { header: 'Company Name', key: 'name', width: 28 },
      { header: 'Receipt Number', key: 'rcpt', width: 16 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Total Price Before VAT', key: 'taxable', width: 20 },
      { header: 'VAT (15%)', key: 'vat', width: 14 },
      { header: 'Total Price', key: 'total', width: 16 },
      { header: 'Withholding', key: 'wh', width: 14 },
      { header: 'VAT Withholding', key: 'vat_wh', width: 14 },
      { header: 'Expected Payment @ Bank', key: 'exp', width: 22 },
      { header: 'Amount In Bank', key: 'bank_amt', width: 18 },
      { header: 'Difference', key: 'diff', width: 14 },
      { header: 'Remark', key: 'remark', width: 16 },
    ];
    wsPur.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsPur.getRow(1).fill = HEADER_FILL;

    purchases.forEach((p: any) => {
      const row = wsPur.addRow([
        p.no,
        p.invoice_no,
        p.bank_code_1,
        p.bank_code_2,
        p.party_tin || '',
        p.party_name || '',
        p.receipt_no || '',
        p.date || '',
        p.total_before_vat,
        p.vat_amount,
        p.grand_total,
        p.withholding,
        p.vat_withholding,
        p.expected_payment,
        p.amount_in_bank,
        p.difference,
        p.status,
      ]);
      [9, 10, 11, 12, 13, 14, 15, 16].forEach((ci) => {
        row.getCell(ci).numFmt = MONEY;
      });
    });

    // 4. Bank 01 to Bank 10
    for (let idx = 1; idx <= 10; idx++) {
      const acc = accounts.find((a: any) => a.account_no === idx) || { bank_name: 'CBE', account_no: idx };
      const sheetName = `Bank ${String(idx).padStart(2, '0')}`;
      const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

      ws.columns = [
        { header: 'No', key: 'no', width: 6 },
        { header: 'Bank Code', key: 'bcode', width: 14 },
        { header: 'Bank Name', key: 'bname', width: 14 },
        { header: 'Purchase Code 1', key: 'p1', width: 16 },
        { header: 'Purchase Code 2', key: 'p2', width: 16 },
        { header: 'Debit', key: 'debit', width: 16 },
        { header: 'Pur. Amt. Expected at Bank', key: 'pexp', width: 22 },
        { header: 'Difference', key: 'pdiff', width: 14 },
        { header: 'Remark', key: 'premark', width: 16 },
        { header: 'Sales Code 1', key: 's1', width: 16 },
        { header: 'Sales Code 2', key: 's2', width: 16 },
        { header: 'Credit', key: 'credit', width: 16 },
        { header: 'Sales Amt. Expected at Bank', key: 'sexp', width: 22 },
        { header: 'Difference', key: 'sdiff', width: 14 },
        { header: 'Remark', key: 'sremark', width: 16 },
        { header: 'Value Date', key: 'vdate', width: 14 },
        { header: 'Bank Code', key: 'bcode2', width: 14 },
      ];

      const hRow = ws.getRow(1);
      hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hRow.fill = HEADER_FILL;

      if ((acc as any).id) {
        const txs = await this.listBankTransactions({ bank_account_id: (acc as any).id, limit: 1000 });
        txs.forEach((tx: any) => {
          const row = ws.addRow([
            tx.row_no,
            tx.bank_code,
            acc.bank_name,
            tx.purchase_code_1 || '',
            tx.purchase_code_2 || '',
            tx.debit || 0,
            tx.purchase_expected || 0,
            tx.purchase_difference || 0,
            tx.purchase_remark || '',
            tx.sales_code_1 || '',
            tx.sales_code_2 || '',
            tx.credit || 0,
            tx.sales_expected || 0,
            tx.sales_difference || 0,
            tx.sales_remark || '',
            tx.value_date || '',
            tx.bank_code,
          ]);
          [6, 7, 8, 12, 13, 14].forEach((ci) => {
            row.getCell(ci).numFmt = MONEY;
          });
        });
      }
    }

    return wb.xlsx.writeBuffer();
  }
}
