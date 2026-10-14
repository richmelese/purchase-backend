import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from '../../orm/data-source.js';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { AuditLogEntity } from '../../entities/audit-log.entity.js';

const KIND: Record<string, string> = { purchases: 'purchase', sales: 'sale' };

const money = (n: any) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  async record(
    user: any,
    details: { action: string; entity: string; entityId?: number | null; summary: string },
    ip: string | null = null,
  ): Promise<void> {
    try {
      this.dataSource.execute(
        'INSERT INTO audit_log (user_id, username, action, entity, entity_id, summary, ip) VALUES (?,?,?,?,?,?,?)',
        [
          user?.id ?? null,
          user?.username ?? null,
          details.action,
          details.entity,
          details.entityId ?? null,
          details.summary,
          ip ?? null,
        ],
      );
    } catch (e: any) {
      this.logger.error(`Audit record error: ${e.message}`);
    }
  }

  async listAudit({ q, entity, user, limit = 300 }: any = {}): Promise<AuditLogEntity[]> {
    const where: string[] = [];
    const params: any[] = [];
    const maxLimit = Math.min(+limit || 300, 2000);

    if (q) {
      where.push('(summary LIKE ? OR username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (entity) {
      where.push('entity = ?');
      params.push(entity);
    }
    if (user) {
      where.push('username = ?');
      params.push(user);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(maxLimit);

    return this.dataSource.query<AuditLogEntity>(
      `SELECT * FROM audit_log ${whereClause} ORDER BY id DESC LIMIT ?`,
      params,
    );
  }

  resolveBeforeLabel(path: string, method: string): string | null {
    if (method !== 'DELETE') return null;
    const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const [a, b] = parts;
    if (!b) return null;

    try {
      if (KIND[a]) {
        const row = this.dataSource.queryOne<{ l: string }>('SELECT invoice_no AS l FROM invoices WHERE id = ?', [+b]);
        return row?.l || null;
      }
      if (a === 'payments') {
        const row = this.dataSource.queryOne<{ l: string }>(
          `SELECT i.invoice_no || ' · ' || p.amount AS l FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?`,
          [+b],
        );
        return row?.l || null;
      }
      if (a === 'parties') {
        const row = this.dataSource.queryOne<{ l: string }>('SELECT name AS l FROM parties WHERE id = ?', [+b]);
        return row?.l || null;
      }
      if (a === 'products') {
        const row = this.dataSource.queryOne<{ l: string }>(
          "SELECT code || ' – ' || name_en AS l FROM products WHERE id = ?",
          [+b],
        );
        return row?.l || null;
      }
      if (a === 'issues') {
        const row = this.dataSource.queryOne<{ l: string }>('SELECT issue_no AS l FROM stock_issues WHERE id = ?', [+b]);
        return row?.l || null;
      }
      if (a === 'users') {
        const row = this.dataSource.queryOne<{ l: string }>('SELECT username AS l FROM users WHERE id = ?', [+b]);
        return row?.l || null;
      }
    } catch {
      /* ignore lookup error */
    }
    return null;
  }

  describe(
    path: string,
    method: string,
    reqBody: any,
    resBody: any,
    label: string | null,
  ): { action: string; entity: string; entityId?: number | null; summary: string } | null {
    const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const [a, b, c] = parts;
    const m = method;
    const B = reqBody || {};
    const body = resBody || {};
    const kind = KIND[a];

    if (kind) {
      const word = kind === 'purchase' ? 'Purchase' : 'Sale';
      if (m === 'POST' && !b) {
        return {
          action: 'create',
          entity: kind,
          entityId: body?.id,
          summary: `${word} ${body?.invoice_no} created – ${body?.party_name || 'no party'}, total ${money(body?.grand_total)}`,
        };
      }
      if (m === 'POST' && b === 'report-status') {
        return {
          action: 'update',
          entity: kind,
          summary: `${(B.ids || []).length} ${kind}(s) marked “${B.status}”`,
        };
      }
      if (m === 'PUT' && b && !c) {
        return {
          action: 'update',
          entity: kind,
          entityId: +b,
          summary: `${word} ${body?.invoice_no} edited – total ${money(body?.grand_total)}`,
        };
      }
      if (m === 'DELETE' && b) {
        return {
          action: 'delete',
          entity: kind,
          entityId: +b,
          summary: `${word} ${label || `#${b}`} deleted`,
        };
      }
      if (m === 'PUT' && c === 'withholding') {
        return {
          action: 'update',
          entity: 'withholding',
          entityId: +b,
          summary: `Withholding updated on ${body?.invoice_no}: ${body?.wh_receipt_type || '–'}, paid ${money(body?.wh_paid)}`,
        };
      }
      if (m === 'POST' && c === 'payments') {
        return {
          action: 'create',
          entity: 'payment',
          entityId: +b,
          summary: `Payment ${money(B.amount)} recorded on ${body?.invoice_no} (${B.method || ''})`,
        };
      }
    }

    switch (a) {
      case 'payments':
        return m === 'DELETE'
          ? { action: 'delete', entity: 'payment', entityId: +b, summary: `Payment deleted (${label || b})` }
          : null;
      case 'parties':
        if (m === 'POST' && c === 'account') {
          const n = this.dataSource.queryOne<{ name: string }>('SELECT name FROM parties WHERE id = ?', [+b])?.name || b;
          return { action: 'update', entity: 'party', entityId: +b, summary: `Company login ${body?.created ? 'created' : 'password reset'} for “${n}” (user ${body?.username})` };
        }
        if (m === 'POST') {
          return {
            action: 'create',
            entity: 'party',
            entityId: body?.id,
            summary: `Company “${body?.name}” added${body?.tin ? ` (TIN ${body.tin})` : ''}${body?.account ? ` with login ${body.account.username}` : ''}`,
          };
        }
        if (m === 'PUT') return { action: 'update', entity: 'party', entityId: +b, summary: `Company “${body?.name}” edited` };
        if (m === 'DELETE') return { action: 'delete', entity: 'party', entityId: +b, summary: `Company “${label || b}” deleted` };
        return null;
      case 'products':
        if (m === 'POST') return { action: 'create', entity: 'product', entityId: body?.id, summary: `Product ${body?.code} – ${body?.name_en} added` };
        if (m === 'PUT') return { action: 'update', entity: 'product', entityId: +b, summary: `Product ${body?.code} – ${body?.name_en} edited` };
        if (m === 'DELETE') return { action: 'delete', entity: 'product', entityId: +b, summary: `Product ${label || b} deleted` };
        return null;
      case 'issues':
        if (m === 'POST') return { action: 'create', entity: 'stock', summary: `Stock issue ${body?.issue_no} – qty ${B.qty} to ${B.department || '–'}` };
        if (m === 'DELETE') return { action: 'delete', entity: 'stock', entityId: +b, summary: `Stock issue ${label || b} deleted` };
        return null;
      case 'import':
        return {
          action: 'other',
          entity: b === 'products' ? 'product' : 'party',
          summary: `Imported ${b} from Excel: ${body?.added} added, ${body?.updated} updated`,
        };
      case 'lookups':
        return {
          action: m === 'POST' && !c ? 'create' : m === 'DELETE' ? 'delete' : 'update',
          entity: 'setting',
          summary: `Dropdown list “${b}”: ${
            m === 'POST' && !c
              ? `added “${B.label}”`
              : m === 'DELETE'
              ? `removed “${decodeURIComponent(c)}”`
              : c && parts[3] === 'move'
              ? `moved “${decodeURIComponent(c)}” ${B.dir}`
              : `renamed “${decodeURIComponent(c)}” to “${B.label}”`
          }`,
        };
      case 'settings':
        return { action: 'update', entity: 'setting', summary: `Settings changed: ${Object.keys(B).join(', ')}` };
      case 'company-profile':
        return { action: 'update', entity: 'setting', summary: `Company profile saved – ${B.general?.company_name || 'company'}` };
      case 'vat':
        return { action: 'update', entity: 'vat', summary: `VAT declaration adjustments saved for FY ${B.fy}` };
      case 'users':
        if (m === 'POST') return { action: 'create', entity: 'user', summary: `User “${B.username}” created (${B.role === 'admin' ? 'administrator' : 'user'})` };
        if (m === 'PUT') {
          const u = this.dataSource.queryOne<{ username: string }>('SELECT username FROM users WHERE id = ?', [+b])?.username || b;
          const what = [
            B.active === true ? 'activated' : B.active === false ? 'deactivated' : null,
            B.role ? `role ${B.role}` : null,
            B.password ? 'password reset' : null,
          ]
            .filter(Boolean)
            .join(', ');
          return { action: 'update', entity: 'user', entityId: +b, summary: `User “${u}” updated${what ? `: ${what}` : ''}` };
        }
        if (m === 'DELETE') return { action: 'delete', entity: 'user', entityId: +b, summary: `User “${label || b}” deleted` };
        return null;
      case 'auth':
        return b === 'password' ? { action: 'update', entity: 'user', summary: 'Changed own password' } : null;
      case 'backup':
        return { action: 'other', entity: 'setting', summary: 'Database backup downloaded' };
      default:
        return null;
    }
  }
}
