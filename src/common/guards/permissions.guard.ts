import { CanActivate, ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { COMPANY_ACCESS_KEY } from '../decorators/account-scope.decorator.js';
import { PERMISSION_KEY } from '../decorators/permission.decorator.js';
import { assertCan, Grant } from '../permissions.js';

/**
 * Role-based access for staff users. Deny by default: every non-public endpoint must declare
 * @Permission(...), @AnyStaff() or @CheckedInHandler(); an undeclared endpoint fails closed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const user = context.switchToHttp().getRequest().user;
    const rule = this.reflector.getAllAndOverride<Grant[] | 'any' | 'handler'>(PERMISSION_KEY, targets);

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    // Company accounts are limited by AccountScopeGuard to their own portal endpoints.
    if (user?.party_id && this.reflector.getAllAndOverride<boolean>(COMPANY_ACCESS_KEY, targets)) return true;
    if (!user) return true; // AuthGuard has already rejected anonymous requests to non-public endpoints
    if (rule === 'any' || rule === 'handler') return true;
    if (!rule) {
      const name = `${context.getClass().name}.${context.getHandler().name}`;
      throw new InternalServerErrorException(`Endpoint ${name} has no permission rule`);
    }
    assertCan(user, ...rule);
    return true;
  }
}
