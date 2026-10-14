import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'node:crypto';
import { DataSource } from '../../orm/data-source.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { parseCompanyRights } from '../permissions.js';

const COOKIE_NAME = 'psm_session';

function readCookie(req: any, name = COOKIE_NAME): string | null {
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const token = readCookie(request);

    if (token) {
      const row = this.dataSource.queryOne(
        `SELECT u.*, r.name as role_name, r.label as role_label, r.permissions as role_permissions, pc.name as company_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN parties pc ON pc.id = u.party_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
        [sha256(token), Date.now()],
      );
      if (row) {
        let permissions = {};
        try {
          permissions = typeof row.role_permissions === 'string' ? JSON.parse(row.role_permissions) : (row.role_permissions || {});
        } catch {}

        const accessAll = Boolean(row.access_all_parties ?? 1);
        const assignedParties = accessAll ? [] : this.dataSource.query<{ id: number; name: string; tin: string; type: string; rights: string | null }>(
          `SELECT p.id, p.name, p.tin, p.type, up.rights
           FROM user_parties up
           JOIN parties p ON p.id = up.party_id
           WHERE up.user_id = ?`,
          [row.id],
        );

        request.user = {
          id: row.id,
          username: row.username,
          full_name: row.full_name,
          role: row.role || row.role_name || 'user',
          role_id: row.role_id,
          role_name: row.role_name || row.role,
          role_label: row.role_label || (row.role === 'admin' ? 'Administrator' : 'User'),
          permissions,
          access_all_parties: accessAll,
          assigned_parties: assignedParties.map(({ rights, ...p }) => ({ ...p, rights: parseCompanyRights(rights) })),
          // Companies the user may see; what they may do there is in party_rights.
          party_rights: Object.fromEntries(assignedParties.map((p) => [p.id, parseCompanyRights(p.rights)])),
          assigned_party_ids: assignedParties.filter((p) => parseCompanyRights(p.rights).view).map((p) => p.id),
          active: !!row.active,
          party_id: row.party_id || null,
          company_name: row.party_id ? row.company_name : null,
          must_change_password: !!row.must_change_password,
          created_at: row.created_at,
          last_login: row.last_login,
        };
      }
    }

    if (isPublic) {
      return true;
    }

    if (!request.user) {
      throw new UnauthorizedException('Please sign in');
    }

    return true;
  }
}
