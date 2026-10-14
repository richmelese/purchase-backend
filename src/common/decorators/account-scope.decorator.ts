import { SetMetadata } from '@nestjs/common';

/** Endpoints a company (portal) account may call. Everything else is refused for them. */
export const COMPANY_ACCESS_KEY = 'companyAccess';
export const CompanyAccess = () => SetMetadata(COMPANY_ACCESS_KEY, true);

/** Endpoints usable while the user still has to replace a generated / reset password. */
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
