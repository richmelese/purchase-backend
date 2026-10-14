import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PENDING_PASSWORD_KEY, COMPANY_ACCESS_KEY } from '../decorators/account-scope.decorator.js';

/**
 * Runs after AuthGuard. Deny-by-default for company accounts: they reach only @CompanyAccess()
 * endpoints, which always filter by their own company. Users with a generated / reset password
 * reach only @AllowPendingPassword() endpoints until they choose a new one.
 */
@Injectable()
export class AccountScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user) return true; // public endpoint (AuthGuard already rejected anonymous calls elsewhere)
    const targets = [context.getHandler(), context.getClass()];

    if (user.must_change_password && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets)) {
      throw new ForbiddenException({ message: 'Please change your password to continue', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (user.party_id && !this.reflector.getAllAndOverride<boolean>(COMPANY_ACCESS_KEY, targets)) {
      throw new ForbiddenException({ message: 'This page is not available for company accounts', code: 'COMPANY_ACCOUNT' });
    }
    return true;
  }
}
