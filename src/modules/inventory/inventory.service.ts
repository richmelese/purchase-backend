import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { StockIssueEntity } from '../../entities/stock-issue.entity.js';
import { ProductsService } from '../products/products.service.js';

const str = (v: any) => (v == null ? '' : String(v).trim());

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(StockIssueEntity) private readonly issueRepo: Repository<StockIssueEntity>,
    private readonly productsService: ProductsService,
  ) {}

  public async listIssues() {
    const sql = `SELECT s.*, p.code, p.name_en FROM stock_issues s
      JOIN products p ON p.id = s.product_id ORDER BY s.date DESC, s.id DESC`;
    return this.issueRepo.getDataSource().query(sql);
  }

  public async createIssue(body: any) {
    const qty = Number(body.qty);
    const errors: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(body.date))) errors.date = 'Required';
    if (!body.product_id) errors.product_id = 'Required';
    if (!(qty > 0)) errors.qty = 'Must be > 0';
    if (Object.keys(errors).length) {
      throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });
    }

    const available = await this.productsService.currentStock(+body.product_id);
    if (qty > available) {
      throw new BadRequestException({ message: `Only ${available} in stock`, fields: { qty: `Max ${available}` } });
    }

    const ds = this.issueRepo.getDataSource();
    const max = ds.queryOne<{ n: number }>(
      "SELECT MAX(CAST(SUBSTR(issue_no, 4) AS INTEGER)) AS n FROM stock_issues WHERE issue_no GLOB 'ISS[0-9]*'",
    );
    const issueNo = str(body.issue_no) || `ISS${String((max?.n || 0) + 1).padStart(4, '0')}`;

    try {
      await this.issueRepo.insert({
        issue_no: issueNo,
        date: str(body.date),
        product_id: +body.product_id,
        qty,
        department: str(body.department) || null,
        purpose: str(body.purpose) || null,
        approved_by: str(body.approved_by) || null,
      });
    } catch (e: any) {
      if (/UNIQUE/.test(e.message)) {
        throw new ConflictException({ message: 'Issue number already exists', fields: { issue_no: 'Already exists' } });
      }
      throw e;
    }

    return { ok: true, issue_no: issueNo };
  }

  public async deleteIssue(id: number) {
    await this.issueRepo.delete(id);
  }

  public async stockIn({ productId, from, to }: any = {}) {
    const where: string[] = ["i.kind = 'P'", 'l.product_id IS NOT NULL', 'p.track_stock = 1'];
    const params: any[] = [];
    if (productId) {
      where.push('l.product_id = ?');
      params.push(+productId);
    }
    if (from) {
      where.push('i.date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('i.date <= ?');
      params.push(to);
    }

    const sql = `SELECT i.id AS invoice_id, i.invoice_no AS purchase_code, p.code AS product_code, i.date, i.vat_receipt_no AS grn_no,
        p.name_en AS product_name, i.party_tin AS supplier_tin, i.party_name AS supplier_name,
        l.qty AS quantity, l.unit_price AS unit_cost, l.total AS total_cost, i.notes AS remark
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
      WHERE ${where.join(' AND ')} ORDER BY i.date DESC, i.id DESC, l.line_no`;

    return this.issueRepo.getDataSource().query(sql, params);
  }

  public async stockOut({ productId, from, to }: any = {}) {
    const sw: string[] = ["i.kind = 'S'", 'l.product_id IS NOT NULL', 'p.track_stock = 1'];
    const iw: string[] = ['1 = 1'];
    const sp: any[] = [];
    const ip: any[] = [];

    if (productId) {
      sw.push('l.product_id = ?');
      sp.push(+productId);
      iw.push('s.product_id = ?');
      ip.push(+productId);
    }
    if (from) {
      sw.push('i.date >= ?');
      sp.push(from);
      iw.push('s.date >= ?');
      ip.push(from);
    }
    if (to) {
      sw.push('i.date <= ?');
      sp.push(to);
      iw.push('s.date <= ?');
      ip.push(to);
    }

    const sql = `SELECT 'Sale' AS source, i.id AS ref_id, i.invoice_no AS ref_no, i.date, p.code AS product_code, p.name_en AS product_name,
        l.qty AS quantity, i.party_name AS issued_to, 'Sales' AS purpose, NULL AS approved_by, l.unit_price AS unit_price
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
      WHERE ${sw.join(' AND ')}
      UNION ALL
      SELECT 'Issue', s.id, s.issue_no, s.date, p.code, p.name_en, s.qty, s.department, s.purpose, s.approved_by, NULL
      FROM stock_issues s JOIN products p ON p.id = s.product_id
      WHERE ${iw.join(' AND ')}
      ORDER BY date DESC, ref_no DESC`;

    return this.issueRepo.getDataSource().query(sql, [...sp, ...ip]);
  }
}
