import { Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { UserEntity } from '../../entities/user.entity.js';
import { hashPassword } from '../auth/auth.service.js';
import { allowedParties, isAdmin, parseCompanyRights, CompanyRights, RIGHTS } from '../../common/permissions.js';

/** Company access: all companies, or chosen companies each with its own rights. */
type Access = { all: boolean; ids: number[]; rights: Record<number, CompanyRights> };
type RoleChoice = { id: number | null; name: string; base: 'admin' | 'user' };

@Injectable()
export class UsersService {
  constructor(@InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>) {}

  public async listUsers() {
    const rows = await this.userRepo.find({ order: { active: 'ASC', username: 'ASC' } });
    const ds = this.userRepo.getDataSource();

    const roles = ds.query<any>('SELECT id, name, label, permissions FROM roles');
    const roleMap = new Map(roles.map((r: any) => [r.id, r]));

    const companies = new Map(ds.query<{ id: number; name: string }>('SELECT id, name FROM parties').map((p) => [p.id, p.name]));

    const userParties = ds.query<any>(`
      SELECT up.user_id, p.id, p.name, p.tin, p.type, up.rights
      FROM user_parties up
      JOIN parties p ON p.id = up.party_id
      ORDER BY p.name ASC
    `);

    const partiesByUser = new Map<number, any[]>();
    for (const up of userParties) {
      if (!partiesByUser.has(up.user_id)) partiesByUser.set(up.user_id, []);
      partiesByUser.get(up.user_id)!.push({ id: up.id, name: up.name, tin: up.tin, type: up.type, rights: parseCompanyRights(up.rights) });
    }

    return rows.map((u) => {
      const roleObj = u.role_id ? roleMap.get(u.role_id) : (roles.find((r: any) => r.name === u.role) || null);
      let permissions = {};
      try {
        permissions = typeof roleObj?.permissions === 'string' ? JSON.parse(roleObj.permissions) : (roleObj?.permissions || {});
      } catch {}

      const assigned = partiesByUser.get(u.id) || [];

      return {
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        role_id: roleObj?.id || u.role_id || null,
        role_name: roleObj?.name || u.role,
        role_label: u.party_id ? 'Company account' : roleObj?.label || (u.role === 'admin' ? 'Administrator' : 'User'),
        party_id: u.party_id || null,
        company_name: u.party_id ? companies.get(u.party_id) || null : null,
        must_change_password: !!u.must_change_password,
        permissions,
        access_all_parties: Boolean(u.access_all_parties ?? 1),
        assigned_parties: assigned,
        assigned_party_ids: assigned.map((p) => p.id),
        active: !!u.active,
        created_at: u.created_at,
        last_login: u.last_login,
      };
    });
  }

  /** New staff account: role and company access are chosen now; the password is temporary. */
  public async createUser(actor: any, body: any) {
    const { username, full_name, password } = body;
    const u = String(username ?? '').trim();
    const errors: Record<string, string> = {};
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(u)) errors.username = '3–40 letters, numbers, . _ @ -';
    if (!String(full_name ?? '').trim()) errors.full_name = 'Required';
    if (typeof password !== 'string' || password.length < 8) errors.password = 'At least 8 characters';
    const role = this.resolveRole(body.role_id, body.role, errors);
    const access = this.resolveAccess(body.access_all_parties, body.party_ids, body.party_rights, errors);
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });

    this.assertMayGrant(actor, role, access);
    if (await this.userRepo.findOne({ where: { username: u } })) {
      throw new ConflictException({ message: 'That username is already taken', fields: { username: 'Already taken' } });
    }

    const ds = this.userRepo.getDataSource();
    ds.transaction(() => {
      const { lastInsertRowid } = ds.execute(
        `INSERT INTO users (username, full_name, password_hash, role, role_id, access_all_parties, active, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [u, String(full_name).trim(), hashPassword(password), role.base, role.id, access.all ? 1 : 0],
      );
      this.setParties(Number(lastInsertRowid), access);
    });
    return this.listUsers();
  }

  public async updateUser(actor: any, id: number, body: any) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const ds = this.userRepo.getDataSource();
    const errors: Record<string, string> = {};
    const self = id === actor.id;
    const targetIsAdmin = this.isAdminRow(user);

    if (!isAdmin(actor) && targetIsAdmin) {
      throw new ForbiddenException({ message: 'Only an administrator can change an administrator account', code: 'NO_PERMISSION' });
    }

    const fullName = body.full_name !== undefined ? String(body.full_name).trim() : user.full_name;
    if (!fullName) errors.full_name = 'Required';
    if (body.password && (typeof body.password !== 'string' || body.password.length < 8)) errors.password = 'At least 8 characters';

    // Company (portal) accounts stay plain users tied to their own company, whatever the form sends.
    const companyAccount = !!user.party_id;
    const current = this.accessOf(id);
    const currentParties = current.ids;
    const roleChange = !companyAccount && (body.role_id !== undefined || body.role !== undefined);
    const accessChange = !companyAccount && (body.access_all_parties !== undefined || body.party_ids !== undefined || body.party_rights !== undefined);
    const role: RoleChoice = roleChange
      ? this.resolveRole(body.role_id, body.role, errors)
      : { id: user.role_id ?? null, name: user.role, base: user.role === 'admin' ? 'admin' : 'user' };
    const access: Access = accessChange
      ? this.resolveAccess(body.access_all_parties ?? !!user.access_all_parties, body.party_ids ?? currentParties, body.party_rights ?? current.rights, errors)
      : { all: !!user.access_all_parties, ids: currentParties, rights: current.rights };
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Please correct the highlighted fields', fields: errors });

    const nextActive = body.active !== undefined ? (body.active ? 1 : 0) : user.active;
    const roleChanged = roleChange && (role.id ?? null) !== (user.role_id ?? null);
    const accessChanged = accessChange && (access.all !== !!user.access_all_parties
      || access.ids.length !== currentParties.length || access.ids.some((p) => !currentParties.includes(p))
      || access.ids.some((p) => RIGHTS.some((r) => access.rights[p]?.[r] !== current.rights[p]?.[r])));
    if (self && (roleChanged || accessChanged || !nextActive)) {
      throw new BadRequestException('You cannot change your own role, company access or status');
    }
    if (roleChanged || accessChanged) this.assertMayGrant(actor, role, access);

    const losesAdmin = targetIsAdmin && user.active && (role.base !== 'admin' || !nextActive);
    if (losesAdmin && (await this.activeAdmins()) <= 1) {
      throw new BadRequestException('There must be at least one active administrator');
    }

    ds.transaction(() => {
      const sets: Record<string, any> = { full_name: fullName, active: nextActive };
      if (companyAccount) Object.assign(sets, { role: 'user', role_id: null, access_all_parties: 0 });
      else Object.assign(sets, { role: role.base, role_id: role.id, access_all_parties: access.all ? 1 : 0 });
      if (body.password) {
        sets.password_hash = hashPassword(body.password);
        // A password set by someone else is temporary: the user replaces it at the next sign-in.
        sets.must_change_password = self ? 0 : 1;
      }
      const keys = Object.keys(sets);
      ds.execute(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => sets[k]), id]);
      if (accessChange) this.setParties(id, access);
      // Sign the user out where their access changed, so the new rules apply immediately.
      if (!nextActive || body.password || roleChanged || accessChanged) ds.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
    });
    return this.listUsers();
  }

  public async deleteUser(actor: any, id: number) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (id === actor.id) throw new BadRequestException('You cannot delete your own account');
    if (!isAdmin(actor) && this.isAdminRow(user)) {
      throw new ForbiddenException({ message: 'Only an administrator can delete an administrator account', code: 'NO_PERMISSION' });
    }
    if (this.isAdminRow(user) && user.active && (await this.activeAdmins()) <= 1) {
      throw new BadRequestException('There must be at least one active administrator');
    }
    // Sessions and company links are removed with the user (ON DELETE CASCADE).
    this.userRepo.getDataSource().execute('DELETE FROM users WHERE id = ?', [id]);
    return this.listUsers();
  }

  // ---- helpers ---------------------------------------------------------------

  private async activeAdmins(): Promise<number> {
    const count = this.userRepo.getDataSource().queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM users WHERE (role = 'admin' OR role_id = (SELECT id FROM roles WHERE name = 'admin')) AND active = 1",
    );
    return count?.n || 0;
  }

  private isAdminRow(u: any): boolean {
    if (u.role === 'admin') return true;
    if (!u.role_id) return false;
    return this.userRepo.getDataSource().queryOne<{ name: string }>('SELECT name FROM roles WHERE id = ?', [u.role_id])?.name === 'admin';
  }

  private accessOf(userId: number): { ids: number[]; rights: Record<number, CompanyRights> } {
    const rows = this.userRepo.getDataSource()
      .query<{ party_id: number; rights: string | null }>('SELECT party_id, rights FROM user_parties WHERE user_id = ?', [userId]);
    return { ids: rows.map((r) => r.party_id), rights: Object.fromEntries(rows.map((r) => [r.party_id, parseCompanyRights(r.rights)])) };
  }

  /** Role chosen in the form (by id, or by name for older clients). Required. */
  private resolveRole(roleId: any, roleName: any, errors: Record<string, string>): RoleChoice {
    const ds = this.userRepo.getDataSource();
    const row = roleId
      ? ds.queryOne<{ id: number; name: string }>('SELECT id, name FROM roles WHERE id = ?', [Number(roleId)])
      : roleName
        ? ds.queryOne<{ id: number; name: string }>('SELECT id, name FROM roles WHERE name = ?', [String(roleName)])
        : null;
    if (!row) {
      errors.role_id = 'Choose a role';
      return { id: null, name: 'user', base: 'user' };
    }
    return { id: row.id, name: row.name, base: row.name === 'admin' ? 'admin' : 'user' };
  }

  /** "All companies", or a non-empty list of existing companies, each with its rights (default: all). */
  private resolveAccess(all: any, partyIds: any, partyRights: any, errors: Record<string, string>): Access {
    const everything = !(all === false || all === 0 || all === '0');
    if (everything) return { all: true, ids: [], rights: {} };
    const fromRights = partyRights && typeof partyRights === 'object' ? Object.keys(partyRights) : [];
    const wanted = [...new Set((Array.isArray(partyIds) ? partyIds : fromRights).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const ids = wanted.length
      ? this.userRepo.getDataSource()
        .query<{ id: number }>(`SELECT id FROM parties WHERE id IN (${wanted.map(() => '?').join(',')})`, wanted)
        .map((r) => r.id)
      : [];
    if (!ids.length) errors.party_ids = 'Choose at least one company, or give access to all companies';
    const rights = Object.fromEntries(ids.map((id) => [id, parseCompanyRights(partyRights?.[id] ?? partyRights?.[String(id)])]));
    return { all: false, ids, rights };
  }

  private setParties(userId: number, access: Access) {
    const ds = this.userRepo.getDataSource();
    ds.execute('DELETE FROM user_parties WHERE user_id = ?', [userId]);
    if (!access.all) {
      for (const pid of access.ids) {
        ds.execute('INSERT OR IGNORE INTO user_parties (user_id, party_id, rights) VALUES (?, ?, ?)', [userId, pid, JSON.stringify(access.rights[pid])]);
      }
    }
  }

  /** Nobody can hand out more than they have: no Administrator role, no companies outside their own access. */
  private assertMayGrant(actor: any, role: RoleChoice, access: Access) {
    if (isAdmin(actor)) return;
    if (role.base === 'admin') {
      throw new ForbiddenException({ message: 'Only an administrator can give the Administrator role', code: 'NO_PERMISSION' });
    }
    const mine = allowedParties(actor);
    if (mine !== null && (access.all || access.ids.some((id) => !mine.includes(id)))) {
      throw new ForbiddenException({ message: 'You can only give access to companies you have access to yourself', code: 'NO_PERMISSION' });
    }
    if (mine !== null && access.ids.some((id) => RIGHTS.some((r) => access.rights[id][r] && !actor.party_rights?.[id]?.[r]))) {
      throw new ForbiddenException({ message: 'You can only give rights you have yourself for each company', code: 'NO_PERMISSION' });
    }
  }
}
