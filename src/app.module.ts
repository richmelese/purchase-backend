import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { OrmModule } from './orm/orm.module.js';
import { AppController } from './app.controller.js';

import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { LookupsModule } from './modules/lookups/lookups.module.js';
import { PartiesModule } from './modules/parties/parties.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { VatModule } from './modules/vat/vat.module.js';
import { WithholdingModule } from './modules/withholding/withholding.module.js';
import { CreditModule } from './modules/credit/credit.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { ImportExportModule } from './modules/import-export/import-export.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { PortalModule } from './modules/portal/portal.module.js';

import { AuthGuard } from './common/guards/auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { AccountScopeGuard } from './common/guards/account-scope.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { AuditInterceptor } from './modules/audit/audit.interceptor.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

function resolveDatabasePath(): string {
  if (process.env.DATABASE_PATH) {
    return path.resolve(process.env.DATABASE_PATH);
  }

  const rootDb = path.resolve(process.cwd(), '..', 'data', 'psm.db');
  if (fs.existsSync(rootDb)) {
    return rootDb;
  }

  const localDb = path.resolve(process.cwd(), 'data', 'psm.db');
  if (fs.existsSync(localDb)) {
    return localDb;
  }

  const dockerDb = '/app/data/psm.db';
  if (fs.existsSync(dockerDb)) {
    return dockerDb;
  }

  // Fallback to local or root directory data/psm.db
  return localDb;
}

@Module({
  imports: [
    OrmModule.forRoot({
      databasePath: resolveDatabasePath(),
    }),
    AuthModule,
    UsersModule,
    SettingsModule,
    LookupsModule,
    PartiesModule,
    ProductsModule,
    InventoryModule,
    VatModule,
    WithholdingModule,
    CreditModule,
    ReportsModule,
    ImportExportModule,
    AuditModule,
    ReconciliationModule,
    RolesModule,
    PortalModule,
    // Parameterized invoice routes placed last so specific endpoints match first
    InvoicesModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AccountScopeGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
