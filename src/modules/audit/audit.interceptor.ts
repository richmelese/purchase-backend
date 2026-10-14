import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';
import { AuditService } from './audit.service.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isBackup = req.path.includes('/backup');

    if (!isWrite && !isBackup) {
      return next.handle();
    }

    const beforeLabel = this.auditService.resolveBeforeLabel(req.path, req.method);

    return next.handle().pipe(
      tap({
        next: (data) => {
          try {
            const desc = this.auditService.describe(
              req.path,
              req.method,
              req.body,
              data,
              beforeLabel,
            );
            if (desc) {
              const user = (req as any).user;
              const ip = req.ip || req.socket.remoteAddress || null;
              this.auditService.record(user, desc, ip);
            }
          } catch (e: any) {
            // Audit logging should not crash the request
          }
        },
      }),
    );
  }
}
