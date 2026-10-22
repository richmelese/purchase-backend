import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from '../../orm/data-source.js';
import { RESOURCES, RIGHTS } from '../../common/roles-data.js';

function parsePermissions(raw: any) {
  if (typeof raw === 'object' && raw !== null) return raw;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

@Injectable()
export class RolesService {
  constructor(private readonly dataSource: DataSource) {}

  public getResourcesAndRights() {
    return { resources: RESOURCES, rights: RIGHTS };
  }

  public listRoles() {
    const rows = this.dataSource.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
      FROM roles r
      ORDER BY r.is_system DESC, r.name ASC
    `);

    return rows.map((r: any) => ({
      ...r,
      is_system: !!r.is_system,
      permissions: parsePermissions(r.permissions),
    }));
  }

  public getRole(id: number) {
    const row = this.dataSource.queryOne(`
      SELECT r.*,
        (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
      FROM roles r
      WHERE r.id = ?
    `, [id]);

    if (!row) throw new NotFoundException('Role not found');
    return {
      ...row,
      is_system: !!row.is_system,
      permissions: parsePermissions(row.permissions),
    };
  }

  public createRole({ name, label, description, permissions }: any) {
    const rawName = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!rawName || rawName.length < 2) {
      throw new BadRequestException({ message: 'Role code/name is required and must be at least 2 characters', fields: { name: 'At least 2 characters' } });
    }
    const rawLabel = String(label || '').trim();
    if (!rawLabel) {
      throw new BadRequestException({ message: 'Role label is required', fields: { label: 'Required' } });
    }

    const existing = this.dataSource.queryOne('SELECT id FROM roles WHERE name = ?', [rawName]);
    if (existing) {
      throw new ConflictException({ message: `A role with code '${rawName}' already exists`, fields: { name: 'Already used' } });
    }

    const permsJson = JSON.stringify(permissions && typeof permissions === 'object' ? permissions : {});

    const res = this.dataSource.execute(`
      INSERT INTO roles (name, label, description, is_system, permissions, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))
    `, [rawName, rawLabel, description ? String(description).trim() : null, permsJson]);

    return this.getRole(Number(res.lastInsertRowid));
  }

  public updateRole(id: number, { name, label, description, permissions }: any) {
    const role = this.getRole(id);

    const rawLabel = label !== undefined ? String(label).trim() : role.label;
    if (!rawLabel) throw new BadRequestException({ message: 'Role label is required', fields: { label: 'Required' } });

    let rawName = role.name;
    if (name !== undefined && !role.is_system) {
      rawName = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!rawName) throw new BadRequestException({ message: 'Role code/name is required', fields: { name: 'Required' } });
      const existing = this.dataSource.queryOne('SELECT id FROM roles WHERE name = ? AND id != ?', [rawName, id]);
      if (existing) throw new ConflictException({ message: `A role with code '${rawName}' already exists`, fields: { name: 'Already used' } });
    }

    let permsJson: string;
    if (role.name === 'admin') {
      permsJson = JSON.stringify(role.permissions);
    } else if (permissions !== undefined) {
      permsJson = JSON.stringify(permissions && typeof permissions === 'object' ? permissions : {});
    } else {
      permsJson = JSON.stringify(role.permissions);
    }

    const desc = description !== undefined ? (description ? String(description).trim() : null) : role.description;

    this.dataSource.execute(`
      UPDATE roles
      SET name = ?, label = ?, description = ?, permissions = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [rawName, rawLabel, desc, permsJson, id]);

    return this.getRole(id);
  }

  public deleteRole(id: number) {
    const role = this.getRole(id);
    if (role.is_system) {
      throw new BadRequestException('System roles cannot be deleted');
    }
    if (role.user_count > 0) {
      throw new BadRequestException(`Cannot delete role '${role.label}' because ${role.user_count} user(s) are assigned to it`);
    }

    this.dataSource.execute('DELETE FROM roles WHERE id = ?', [id]);
    return { ok: true, id };
  }
}
