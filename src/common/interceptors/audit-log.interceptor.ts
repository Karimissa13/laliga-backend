import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { AUDIT_KEY, AuditMeta } from '../decorators/audit.decorator';
import { AuditService } from '../../audit/audit.service';

/**
 * When a handler is decorated with @Audit(action, entity), records an audit log
 * entry after the handler completes successfully. The entity id is taken from the
 * response body (id) or the route param `id`.
 *
 * The response waits for the entry to be written, so "the request succeeded"
 * always means "it is in the activity log". AuditService.record never throws, so
 * waiting can't turn a successful action into a failed response.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.get<AuditMeta>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      concatMap(async (body) => {
        const entityId = body?.id || req.params?.id || undefined;
        await this.audit.record({
          actorId: req.user?.id,
          actorType: req.user ? 'user' : 'system',
          action: meta.action,
          entity: meta.entity,
          entityId,
          ipAddress: req.ip,
          userAgent: req.headers?.['user-agent'],
          metadata: {
            params: req.params,
            method: req.method,
            // Only an explicit `reason` is copied from the body — never the body
            // itself, which can carry passwords or personal data.
            ...(typeof req.body?.reason === 'string' && req.body.reason.trim()
              ? { reason: String(req.body.reason).trim().slice(0, 500) }
              : {}),
          },
        });
        return body;
      }),
    );
  }
}
