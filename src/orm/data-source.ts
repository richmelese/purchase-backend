import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildDefaultRolePermissions } from '../common/roles-data.js';

export interface DataSourceOptions {
  databasePath: string;
  entities?: any[];
  synchronize?: boolean;
}

export class DataSource {
  private db: DatabaseSync;
  private isConnected = false;

  constructor(private readonly options: DataSourceOptions) {}

  public initialize(): this {
    if (this.isConnected) return this;

    const dir = path.dirname(this.options.databasePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.options.databasePath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      try {
        this.db.exec('PRAGMA journal_mode = DELETE;');
      } catch {}
    }
    try {
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch {}
    this.isConnected = true;

    this.runInitialMigrations();
    return this;
  }

  public getDatabase(): DatabaseSync {
    if (!this.isConnected) this.initialize();
    return this.db;
  }

  public query<T = any>(sql: string, params: any = []): T[] {
    const stmt = this.getDatabase().prepare(sql);
    if (params && !Array.isArray(params) && typeof params === 'object') {
      return stmt.all(params) as T[];
    }
    return stmt.all(...params) as T[];
  }

  public queryOne<T = any>(sql: string, params: any = []): T | null {
    const stmt = this.getDatabase().prepare(sql);
    if (params && !Array.isArray(params) && typeof params === 'object') {
      const row = stmt.get(params);
      return (row as T) || null;
    }
    const row = stmt.get(...params);
    return (row as T) || null;
  }

  public execute(sql: string, params: any = []): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.getDatabase().prepare(sql);
    const result = params && !Array.isArray(params) && typeof params === 'object'
      ? stmt.run(params)
      : stmt.run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  public exec(sql: string): void {
    this.getDatabase().exec(sql);
  }

  public transaction<T>(fn: () => T): T {
    this.exec('BEGIN');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (e) {
      this.exec('ROLLBACK');
      throw e;
    }
  }

  private txQueue: Promise<unknown> = Promise.resolve();

  /**
   * `transaction` for callbacks that await (repository methods are async). Commits only after the
   * callback settles and rolls back if it rejects. Calls are queued so they never overlap on the single
   * connection. The callback must only await database work, never network or file I/O.
   */
  public transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      this.exec('BEGIN');
      try {
        const result = await fn();
        this.exec('COMMIT');
        return result;
      } catch (e) {
        this.exec('ROLLBACK');
        throw e;
      }
    };
    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => undefined);
    return next;
  }

  private runInitialMigrations(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS parties (
        id         INTEGER PRIMARY KEY,
        tin        TEXT UNIQUE,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'Supplier',
        mrc1       TEXT, mrc2 TEXT, mrc3 TEXT,
        phone      TEXT, address TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS products (
        id             INTEGER PRIMARY KEY,
        code           TEXT UNIQUE NOT NULL,
        name_en        TEXT NOT NULL,
        name_am        TEXT,
        category       TEXT, brand TEXT, model TEXT,
        unit           INTEGER DEFAULT 7,
        track_stock    INTEGER NOT NULL DEFAULT 1,
        min_stock      REAL DEFAULT 0,
        opening_stock  REAL DEFAULT 0,
        purchase_price REAL DEFAULT 0,
        selling_price  REAL DEFAULT 0,
        created_at     TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id                  INTEGER PRIMARY KEY,
        kind                TEXT NOT NULL CHECK (kind IN ('P','S')),
        invoice_no          TEXT UNIQUE NOT NULL,
        payment_type        TEXT NOT NULL,
        vat_category        TEXT NOT NULL,
        calendar_type       TEXT NOT NULL DEFAULT 'G',
        party_id            INTEGER REFERENCES parties(id) ON DELETE SET NULL,
        party_tin           TEXT,
        party_name          TEXT,
        date                TEXT NOT NULL,
        fy                  INTEGER NOT NULL,
        fy_month            INTEGER NOT NULL,
        receipt_type        TEXT NOT NULL,
        mrc_number          TEXT,
        vat_receipt_no      TEXT NOT NULL,
        report_status       TEXT NOT NULL DEFAULT 'Not Reported',
        notes               TEXT,
        total_amount        REAL DEFAULT 0,
        excise_amount       REAL DEFAULT 0,
        vatable_service_fee REAL DEFAULT 0,
        taxable_amount      REAL DEFAULT 0,
        vat_amount          REAL DEFAULT 0,
        non_vatable_fee     REAL DEFAULT 0,
        grand_total         REAL DEFAULT 0,
        wh_receipt_type     TEXT,
        wh_receipt_no       TEXT,
        wh_receipt_date     TEXT,
        wh_paid             REAL DEFAULT 0,
        created_at          TEXT DEFAULT (datetime('now')),
        updated_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS ix_invoices_period ON invoices(kind, fy, fy_month);

      CREATE TABLE IF NOT EXISTS invoice_lines (
        id                  INTEGER PRIMARY KEY,
        invoice_id          INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        line_no             INTEGER NOT NULL,
        product_id          INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_code        TEXT,
        description         TEXT NOT NULL,
        unit                INTEGER,
        tx_type             INTEGER NOT NULL,
        transaction_type    TEXT NOT NULL,
        qty                 REAL NOT NULL,
        unit_price          REAL NOT NULL,
        total               REAL NOT NULL,
        excise_rate         REAL DEFAULT 0,
        excise_amount       REAL DEFAULT 0,
        vatable_service_fee REAL DEFAULT 0,
        taxable_amount      REAL NOT NULL,
        vat_amount          REAL NOT NULL,
        non_vatable_fee     REAL DEFAULT 0,
        line_total          REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_lines_invoice ON invoice_lines(invoice_id);
      CREATE INDEX IF NOT EXISTS ix_lines_product ON invoice_lines(product_id);

      CREATE TABLE IF NOT EXISTS payments (
        id         INTEGER PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        date       TEXT NOT NULL,
        amount     REAL NOT NULL,
        method     TEXT,
        reference  TEXT,
        notes      TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS stock_issues (
        id          INTEGER PRIMARY KEY,
        issue_no    TEXT UNIQUE NOT NULL,
        date        TEXT NOT NULL,
        product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        qty         REAL NOT NULL,
        department  TEXT,
        purpose     TEXT,
        approved_by TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS vat_adjustments (
        fy       INTEGER NOT NULL,
        fy_month INTEGER NOT NULL,
        line_no  INTEGER NOT NULL,
        amount   REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (fy, fy_month, line_no)
      );

      CREATE TABLE IF NOT EXISTS lookups (
        list   TEXT NOT NULL,
        value  TEXT NOT NULL,
        label  TEXT NOT NULL,
        sort   INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (list, value)
      );

      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
        full_name     TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT DEFAULT (datetime('now')),
        last_login    TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id        INTEGER PRIMARY KEY,
        at        TEXT NOT NULL DEFAULT (datetime('now')),
        user_id   INTEGER,
        username  TEXT,
        action    TEXT NOT NULL,
        entity    TEXT NOT NULL,
        entity_id INTEGER,
        summary   TEXT NOT NULL,
        ip        TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at DESC);

      CREATE TABLE IF NOT EXISTS bank_accounts (
        id              INTEGER PRIMARY KEY,
        account_no      INTEGER NOT NULL UNIQUE,
        bank_name       TEXT NOT NULL,
        account_name    TEXT,
        account_number  TEXT,
        currency        TEXT NOT NULL DEFAULT 'ETB',
        opening_balance REAL DEFAULT 0,
        notes           TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bank_transactions (
        id                  INTEGER PRIMARY KEY,
        bank_account_id     INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
        row_no              INTEGER NOT NULL,
        bank_code           TEXT NOT NULL,
        value_date          TEXT,
        purchase_code_1     TEXT,
        purchase_code_2     TEXT,
        debit               REAL DEFAULT 0,
        purchase_remark     TEXT,
        sales_code_1        TEXT,
        sales_code_2        TEXT,
        credit              REAL DEFAULT 0,
        sales_remark        TEXT,
        created_at          TEXT DEFAULT (datetime('now')),
        updated_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS ix_bt_account ON bank_transactions(bank_account_id);
      CREATE INDEX IF NOT EXISTS ix_bt_p1 ON bank_transactions(purchase_code_1);
      CREATE INDEX IF NOT EXISTS ix_bt_p2 ON bank_transactions(purchase_code_2);
      CREATE INDEX IF NOT EXISTS ix_bt_s1 ON bank_transactions(sales_code_1);
      CREATE INDEX IF NOT EXISTS ix_bt_s2 ON bank_transactions(sales_code_2);

      CREATE TABLE IF NOT EXISTS roles (
        id          INTEGER PRIMARY KEY,
        name        TEXT UNIQUE NOT NULL COLLATE NOCASE,
        label       TEXT NOT NULL,
        description TEXT,
        is_system   INTEGER NOT NULL DEFAULT 0,
        permissions TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_parties (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        party_id   INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, party_id)
      );
      CREATE INDEX IF NOT EXISTS ix_user_parties_uid ON user_parties(user_id);
      CREATE INDEX IF NOT EXISTS ix_user_parties_pid ON user_parties(party_id);
    `);

    // Column migrations
    const hasColumn = (tbl: string, col: string) => {
      try {
        const rows = this.query<{ name: string }>(`PRAGMA table_info(${tbl})`);
        return rows.some((r) => r.name === col);
      } catch {
        return false;
      }
    };

    if (!hasColumn('products', 'serial_no')) this.exec('ALTER TABLE products ADD COLUMN serial_no TEXT');
    if (!hasColumn('products', 'notes')) this.exec('ALTER TABLE products ADD COLUMN notes TEXT');
    if (!hasColumn('invoices', 'created_by')) this.exec('ALTER TABLE invoices ADD COLUMN created_by TEXT');
    if (!hasColumn('invoices', 'updated_by')) this.exec('ALTER TABLE invoices ADD COLUMN updated_by TEXT');
    if (!hasColumn('parties', 'email')) this.exec('ALTER TABLE parties ADD COLUMN email TEXT');
    if (!hasColumn('parties', 'profile')) this.exec('ALTER TABLE parties ADD COLUMN profile TEXT'); // Form 00001 registration details (JSON)
    if (!hasColumn('users', 'role_id')) this.exec('ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL');
    // Company (portal) accounts: one login per supplier / customer, restricted to that company.
    if (!hasColumn('users', 'party_id')) this.exec('ALTER TABLE users ADD COLUMN party_id INTEGER REFERENCES parties(id) ON DELETE CASCADE');
    if (!hasColumn('users', 'must_change_password')) this.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    this.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_party ON users(party_id) WHERE party_id IS NOT NULL');
    // Rights the user has for each assigned company ({ view, create, edit, delete, export }); NULL = all.
    if (!hasColumn('user_parties', 'rights')) this.exec('ALTER TABLE user_parties ADD COLUMN rights TEXT');
    // Staff accounts created by an administrator before temporary passwords existed, and never used yet:
    // their password was chosen by someone else, so they replace it at first sign-in like new accounts.
    if (!this.queryOne("SELECT 1 FROM settings WHERE key = 'migration_first_login_password'")) {
      this.exec(`UPDATE users SET must_change_password = 1
        WHERE last_login IS NULL AND party_id IS NULL AND role <> 'admin'`);
      this.exec("INSERT INTO settings (key, value) VALUES ('migration_first_login_password', datetime('now'))");
    }
    if (!hasColumn('users', 'access_all_parties')) this.exec('ALTER TABLE users ADD COLUMN access_all_parties INTEGER NOT NULL DEFAULT 1');

    const defaultBankNames = ['CBE', 'Awash', 'BOA', 'Dashen', 'Hibret', 'Wegagen', 'NIB', 'Zemen', 'CooP', 'Abay'];
    defaultBankNames.forEach((name, idx) => {
      this.execute(
        'INSERT OR IGNORE INTO bank_accounts (account_no, bank_name, account_name) VALUES (?, ?, ?)',
        [idx + 1, name, `Bank ${String(idx + 1).padStart(2, '0')}`],
      );
    });

    const rolesCount = this.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM roles')?.n || 0;
    if (rolesCount === 0) {
      const defaultRoles = buildDefaultRolePermissions();
      for (const r of defaultRoles) {
        this.execute(
          'INSERT OR IGNORE INTO roles (name, label, description, is_system, permissions) VALUES (?, ?, ?, ?, ?)',
          [r.name, r.label, r.description, r.is_system, JSON.stringify(r.permissions)],
        );
      }
    }
    // Staff accounts without a role id (older sign-ups) get one so their permissions resolve: admins the
    // admin role, everyone else viewer. Company portal accounts (party_id set) deliberately have no role.
    this.exec(`UPDATE users SET role_id = (SELECT id FROM roles WHERE name = CASE WHEN users.role = 'admin' THEN 'admin' ELSE 'viewer' END)
               WHERE role_id IS NULL AND party_id IS NULL`);
  }
}
