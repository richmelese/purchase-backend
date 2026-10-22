import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { ProductEntity } from '../../entities/product.entity.js';
import { LookupsService } from '../lookups/lookups.service.js';
import { round2 } from '../../common/lib/calc.js';

const str = (v: any) => (v == null ? '' : String(v).trim());

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity) private readonly productRepo: Repository<ProductEntity>,
    private readonly lookupsService: LookupsService,
  ) {}

  public async stockReport() {
    const ds = this.productRepo.getDataSource();
    const rows = ds.query<any>(`
      SELECT p.*,
        COALESCE((SELECT SUM(l.qty) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                  WHERE l.product_id = p.id AND i.kind = 'P'), 0) AS stock_in,
        COALESCE((SELECT SUM(l.qty) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                  WHERE l.product_id = p.id AND i.kind = 'S'), 0) AS sold,
        COALESCE((SELECT SUM(s.qty) FROM stock_issues s WHERE s.product_id = p.id), 0) AS issued,
        (SELECT l.unit_price FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                  WHERE l.product_id = p.id AND i.kind = 'P' ORDER BY i.date DESC, l.id DESC LIMIT 1) AS last_cost,
        (SELECT SUM(l.total) / NULLIF(SUM(l.qty), 0) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                  WHERE l.product_id = p.id AND i.kind = 'P') AS avg_cost
      FROM products p ORDER BY p.code`);

    return rows.map((r) => {
      const stock_out = r.sold + r.issued;
      const current = round2(r.opening_stock + r.stock_in - stock_out);
      const unitCost = r.avg_cost ?? r.purchase_price ?? 0;
      let status = 'In stock';
      if (!r.track_stock) status = 'Not tracked';
      else if (current <= 0 && !r.opening_stock && !r.stock_in && !r.min_stock) status = 'No stock yet';
      else if (current <= 0) status = 'Out of stock';
      else if (current <= r.min_stock) status = 'Low stock';
      return {
        ...r,
        stock_out,
        current_stock: current,
        status,
        unit_cost: round2(unitCost),
        stock_value: r.track_stock ? round2(Math.max(current, 0) * unitCost) : 0,
      };
    });
  }

  public async currentStock(productId: number) {
    const report = await this.stockReport();
    const r = report.find((p) => p.id === +productId);
    return r ? r.current_stock : 0;
  }

  public async nextProductCode(): Promise<string> {
    const products = await this.productRepo.find();
    const codes = products.map((r) => r.code);
    const taken = new Set(codes);
    const groups: Record<string, { count: number; max: number; width: number }> = {};
    for (const c of codes) {
      const m = /^(.*?)(\d+)$/.exec(c);
      if (!m) continue;
      const g = (groups[m[1]] ||= { count: 0, max: 0, width: m[2].length });
      g.count += 1;
      if (Number(m[2]) > g.max) {
        g.max = Number(m[2]);
        g.width = m[2].length;
      }
    }
    const [prefix, g] = Object.entries(groups).sort((a, b) => b[1].count - a[1].count)[0] || ['P', { max: 0, width: 5 }];
    let n = g.max;
    let code: string;
    do {
      n += 1;
      code = `${prefix}${String(n).padStart(g.width, '0')}`;
    } while (taken.has(code));
    return code;
  }

  private async validateProduct(b: any) {
    const n = (v: any) => (v === '' || v == null ? 0 : Number(v));
    const p = {
      code: str(b.code),
      name_en: str(b.name_en),
      name_am: str(b.name_am) || null,
      category: str(b.category) || null,
      brand: str(b.brand) || null,
      model: str(b.model) || null,
      serial_no: str(b.serial_no) || null,
      notes: str(b.notes) || null,
      unit: b.unit ? +b.unit : 7,
      track_stock: b.track_stock === false || b.track_stock === 0 || b.track_stock === '0' ? 0 : 1,
      min_stock: n(b.min_stock),
      opening_stock: n(b.opening_stock),
      purchase_price: n(b.purchase_price),
      selling_price: n(b.selling_price),
    };
    const errors: Record<string, string> = {};
    if (!p.code) errors.code = 'Code is required';
    if (!p.name_en) errors.name_en = 'Name is required';

    const units = (await this.lookupsService.lookupValues('unit')).map(Number);
    if (!units.includes(p.unit)) errors.unit = 'Select a unit of measurement';
    for (const k of ['min_stock', 'opening_stock', 'purchase_price', 'selling_price'] as const) {
      if (!Number.isFinite(p[k]) || p[k] < 0) errors[k] = 'Must be ≥ 0';
    }
    if (Object.keys(errors).length) {
      throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });
    }
    return p;
  }

  public async create(body: any) {
    const p = await this.validateProduct(body);
    try {
      const { insertId } = await this.productRepo.insert(p);
      return this.productRepo.findById(insertId);
    } catch (e: any) {
      if (/UNIQUE/.test(e.message)) {
        throw new ConflictException({ message: 'Product code already exists', fields: { code: 'Already exists' } });
      }
      throw e;
    }
  }

  public async update(id: number, body: any) {
    const p = await this.validateProduct(body);
    try {
      const res = await this.productRepo.update(id, p);
      if (!res.affected) throw new NotFoundException('Not found');
    } catch (e: any) {
      if (/UNIQUE/.test(e.message)) {
        throw new ConflictException({ message: 'Product code already exists', fields: { code: 'Already exists' } });
      }
      throw e;
    }
    return this.productRepo.findById(id);
  }

  public async delete(id: number) {
    const ds = this.productRepo.getDataSource();
    const row = ds.queryOne<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM invoice_lines WHERE product_id = ?)
       + (SELECT COUNT(*) FROM stock_issues WHERE product_id = ?) AS n`,
      [id, id],
    );
    const used = row?.n || 0;
    if (used) {
      throw new BadRequestException(`This product is used on ${used} transaction line(s) and cannot be deleted`);
    }
    await this.productRepo.delete(id);
  }

  public async getMovements(productId: number) {
    const ds = this.productRepo.getDataSource();
    const inMovements = ds.query(
      `SELECT i.id AS invoice_id, i.invoice_no AS purchase_code, p.code AS product_code, i.date, i.vat_receipt_no AS grn_no,
        p.name_en AS product_name, i.party_tin AS supplier_tin, i.party_name AS supplier_name,
        l.qty AS quantity, l.unit_price AS unit_cost, l.total AS total_cost, i.notes AS remark
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
      WHERE i.kind = 'P' AND l.product_id = ? AND p.track_stock = 1 ORDER BY i.date DESC, i.id DESC`,
      [+productId],
    );

    const outMovements = ds.query(
      `SELECT 'Sale' AS source, i.id AS ref_id, i.invoice_no AS ref_no, i.date, p.code AS product_code, p.name_en AS product_name,
        l.qty AS quantity, i.party_name AS issued_to, 'Sales' AS purpose, NULL AS approved_by, l.unit_price AS unit_price
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
      WHERE i.kind = 'S' AND l.product_id = ? AND p.track_stock = 1
      UNION ALL
      SELECT 'Issue', s.id, s.issue_no, s.date, p.code, p.name_en, s.qty, s.department, s.purpose, s.approved_by, NULL
      FROM stock_issues s JOIN products p ON p.id = s.product_id
      WHERE s.product_id = ?
      ORDER BY date DESC, ref_no DESC`,
      [+productId, +productId],
    );

    return { in: inMovements, out: outMovements };
  }
}
