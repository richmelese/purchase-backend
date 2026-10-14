import { DataSource } from './data-source.js';
import { getEntityMetadata } from './decorators/entity.decorator.js';
import { getColumnsMetadata } from './decorators/column.decorator.js';

export interface FindOptions<T> {
  where?: Partial<Record<keyof T | string, any>> | string;
  order?: Partial<Record<keyof T | string, 'ASC' | 'DESC'>>;
  limit?: number;
  offset?: number;
  params?: any[];
}

export class Repository<T = any> {
  private tableName: string;
  private primaryKey: string = 'id';

  constructor(
    private readonly entityTarget: any,
    private readonly dataSource: DataSource,
  ) {
    const meta = getEntityMetadata(entityTarget);
    this.tableName = meta?.tableName || entityTarget.name.toLowerCase();

    const columns = getColumnsMetadata(entityTarget);
    const pk = columns.find((c: any) => c.primary);
    if (pk) {
      this.primaryKey = pk.columnName;
    }
  }

  public getTarget() {
    return this.entityTarget;
  }

  public getTableName(): string {
    return this.tableName;
  }

  public getDataSource(): DataSource {
    return this.dataSource;
  }

  public create(data: Partial<T> = {}): T {
    const entity = new this.entityTarget();
    Object.assign(entity, data);
    return entity;
  }

  public async find(options: FindOptions<T> = {}): Promise<T[]> {
    let sql = `SELECT * FROM ${this.tableName}`;
    const params: any[] = [];

    if (options.where) {
      if (typeof options.where === 'string') {
        sql += ` WHERE ${options.where}`;
        if (options.params) params.push(...options.params);
      } else {
        const clauses: string[] = [];
        for (const [key, value] of Object.entries(options.where)) {
          if (value === null) {
            clauses.push(`${key} IS NULL`);
          } else {
            clauses.push(`${key} = ?`);
            params.push(value);
          }
        }
        if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
      }
    }

    if (options.order) {
      const orders = Object.entries(options.order).map(([col, dir]) => `${col} ${dir}`);
      if (orders.length) sql += ` ORDER BY ${orders.join(', ')}`;
    }

    if (options.limit !== undefined) {
      sql += ` LIMIT ${options.limit}`;
      if (options.offset !== undefined) sql += ` OFFSET ${options.offset}`;
    }

    return this.dataSource.query<T>(sql, params);
  }

  public async findOne(options: FindOptions<T>): Promise<T | null> {
    const rows = await this.find({ ...options, limit: 1 });
    return rows.length ? rows[0] : null;
  }

  public async findById(id: any): Promise<T | null> {
    return this.findOne({ where: { [this.primaryKey]: id } as any });
  }

  public async insert(entity: Partial<T>): Promise<{ insertId: number }> {
    const keys = Object.keys(entity).filter((k) => (entity as any)[k] !== undefined);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => (entity as any)[k]);
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = this.dataSource.execute(sql, values);
    return { insertId: Number(result.lastInsertRowid) };
  }

  public async save(entity: Partial<T>): Promise<T> {
    const pkValue = (entity as any)[this.primaryKey];
    if (pkValue !== undefined && pkValue !== null) {
      const existing = await this.findById(pkValue);
      if (existing) {
        await this.update(pkValue, entity);
        return (await this.findById(pkValue)) as T;
      }
    }
    const { insertId } = await this.insert(entity);
    return (await this.findById(insertId || pkValue)) as T;
  }

  public async update(idOrCriteria: any, partial: Partial<T>): Promise<{ affected: number }> {
    const keys = Object.keys(partial).filter((k) => k !== this.primaryKey && (partial as any)[k] !== undefined);
    if (!keys.length) return { affected: 0 };

    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (partial as any)[k]);

    let whereClause = `${this.primaryKey} = ?`;
    let whereParams: any[] = [idOrCriteria];

    if (typeof idOrCriteria === 'object' && idOrCriteria !== null) {
      const clauses = Object.keys(idOrCriteria).map((k) => `${k} = ?`);
      whereClause = clauses.join(' AND ');
      whereParams = Object.values(idOrCriteria);
    }

    const sql = `UPDATE ${this.tableName} SET ${sets} WHERE ${whereClause}`;
    const result = this.dataSource.execute(sql, [...values, ...whereParams]);
    return { affected: result.changes };
  }

  public async delete(idOrCriteria: any): Promise<{ affected: number }> {
    let whereClause = `${this.primaryKey} = ?`;
    let whereParams: any[] = [idOrCriteria];

    if (typeof idOrCriteria === 'object' && idOrCriteria !== null) {
      const clauses = Object.keys(idOrCriteria).map((k) => `${k} = ?`);
      whereClause = clauses.join(' AND ');
      whereParams = Object.values(idOrCriteria);
    }

    const sql = `DELETE FROM ${this.tableName} WHERE ${whereClause}`;
    const result = this.dataSource.execute(sql, whereParams);
    return { affected: result.changes };
  }

  public async count(where?: any): Promise<number> {
    let sql = `SELECT COUNT(*) AS total FROM ${this.tableName}`;
    const params: any[] = [];
    if (where) {
      const clauses: string[] = [];
      for (const [k, v] of Object.entries(where)) {
        clauses.push(`${k} = ?`);
        params.push(v);
      }
      if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    }
    const row = this.dataSource.queryOne<{ total: number }>(sql, params);
    return Number(row?.total || 0);
  }

  public query<R = any>(sql: string, params: any[] = []): R[] {
    return this.dataSource.query<R>(sql, params);
  }

  public queryOne<R = any>(sql: string, params: any[] = []): R | null {
    return this.dataSource.queryOne<R>(sql, params);
  }

  public execute(sql: string, params: any[] = []) {
    return this.dataSource.execute(sql, params);
  }
}
