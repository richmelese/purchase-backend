import { ForbiddenException, NotFoundException } from '@nestjs/common';

// Role permissions are { resource: { view, create, edit, delete, export, <task id>... } } (see roles-data.ts).
// Administrators may do everything; everyone else needs the specific right. A grant may also name a
// task (e.g. purchases/edit/record_payment_p): the right must be on and that task not switched off in the
// role editor. Roles saved before tasks existed have no task keys, so their rights cover every task.
export type Right = 'view' | 'create' | 'edit' | 'delete' | 'export';
export type Grant = readonly [resource: string, right: Right, task?: string];

export const isAdmin = (user: any) => user?.role === 'admin';

export function can(user: any, resource: string, right: Right, task?: string): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const perms = user.permissions?.[resource];
  return !!perms?.[right] && (!task || perms[task] !== false);
}

/** Throws unless the user holds at least one of the grants. */
export function assertCan(user: any, ...grants: Grant[]) {
  if (!grants.some(([resource, right, task]) => can(user, resource, right, task))) {
    throw new ForbiddenException({ message: 'Your role does not allow this action', code: 'NO_PERMISSION' });
  }
}

export const RIGHTS: Right[] = ['view', 'create', 'edit', 'delete', 'export'];
export type CompanyRights = Record<Right, boolean>;

/** Stored rights for one assigned company (JSON); missing / unreadable = every right. */
export function parseCompanyRights(raw: any): CompanyRights {
  let r: any = null;
  try { r = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
  const all = !r || typeof r !== 'object';
  const out = Object.fromEntries(RIGHTS.map((k) => [k, all ? true : !!r[k]])) as CompanyRights;
  if (out.create || out.edit || out.delete || out.export) out.view = true; // acting on a company implies seeing it
  return out;
}

/** Company restriction ("Company & supplier access"): null = all companies, else the ids with `right`. */
export function allowedParties(user: any, right: Right = 'view'): number[] | null {
  if (!user || isAdmin(user) || user.access_all_parties) return null;
  const rights = user.party_rights || {};
  if (right === 'view') return Array.isArray(user.assigned_party_ids) ? user.assigned_party_ids : [];
  return Object.keys(rights).map(Number).filter((id) => rights[id]?.[right]);
}

export function canSeeParty(user: any, partyId: number | null | undefined, right: Right = 'view'): boolean {
  const allowed = allowedParties(user, right);
  return allowed === null || (partyId != null && allowed.includes(Number(partyId)));
}

/**
 * Records of companies outside the user's access behave as if they did not exist; for an assigned
 * company without the needed right (e.g. view-only) the action is refused.
 */
export function assertParty(user: any, partyId: number | null | undefined, right: Right = 'view') {
  if (!canSeeParty(user, partyId, 'view')) throw new NotFoundException('Not found');
  if (right !== 'view' && !canSeeParty(user, partyId, right)) {
    throw new ForbiddenException({ message: `Your access to this company does not include "${right}"`, code: 'NO_PERMISSION' });
  }
}

/** The same user, limited to the companies where they hold `right` (for lists built for that action). */
export function withPartyRight(user: any, right: Right) {
  const allowed = allowedParties(user, right);
  return allowed === null ? user : { ...user, assigned_party_ids: allowed };
}
