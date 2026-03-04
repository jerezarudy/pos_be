import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditLogsService } from './audit-logs.service';
import { requestContext } from '../common/request-context';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'pos_pin',
  'authorization',
  'access_token',
  'refresh_token',
  'token',
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[Truncated]';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 50)
      return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
    return value.map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const key of keys.slice(0, 50)) {
      if (SENSITIVE_KEYS.has(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitize(obj[key], depth + 1);
      }
    }
    if (keys.length > 50) out._truncated = true;
    return out;
  }
  return String(value);
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    console.log('AuditLogInterceptor triggered for HTTP request');
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req: any = http.getRequest();
    const res: any = http.getResponse();

    const startedAt = Date.now();
    const timestamp = new Date();

    const method = String(req?.method ?? '');
    const path = String(req?.originalUrl ?? req?.url ?? '');
    const ip = String(
      (req?.headers?.['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ??
        req?.ip ??
        '',
    );
    const userAgent = String(req?.headers?.['user-agent'] ?? '');

    const resolveUser = () => {
      const directUserId = req?.user?.sub ? String(req.user.sub) : undefined;
      const directUserRole = req?.user?.role
        ? String(req.user.role)
        : undefined;
      if (directUserId || directUserRole) {
        return { userId: directUserId, userRole: directUserRole };
      }

      const authHeader: string | undefined =
        req?.headers?.authorization ?? req?.headers?.Authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return { userId: undefined, userRole: undefined };
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const parts = token.split('.');
      if (parts.length < 2) return { userId: undefined, userRole: undefined };

      try {
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload: any = JSON.parse(payloadJson);
        return {
          userId: payload?.sub ? String(payload.sub) : undefined,
          userRole: payload?.role ? String(payload.role) : undefined,
        };
      } catch {
        return { userId: undefined, userRole: undefined };
      }
    };

    const params = sanitize(req?.params) as Record<string, unknown> | undefined;
    const query = sanitize(req?.query) as Record<string, unknown> | undefined;
    const body = sanitize(req?.body);

    const writeLog = async (
      user: { userId?: string; userRole?: string },
      data: {
        statusCode?: number;
        durationMs?: number;
        errorMessage?: string;
      },
    ) => {
      try {
        await this.auditLogsService.create({
          timestamp,
          method,
          path,
          statusCode: data.statusCode,
          durationMs: data.durationMs,
          ip: ip || undefined,
          userAgent: userAgent || undefined,
          userId: user.userId,
          userRole: user.userRole,
          params,
          query,
          body,
          errorMessage: data.errorMessage,
        });
      } catch {
        // Never block the request on audit logging.
      }
    };

    const user = resolveUser();

    return requestContext.run(user, () =>
      next.handle().pipe(
        tap({
          complete: () => {
            void writeLog(user, {
              statusCode: Number(res?.statusCode) || 200,
              durationMs: Date.now() - startedAt,
            });
          },
        }),
        catchError((err) => {
          const statusCode =
            err instanceof HttpException
              ? err.getStatus()
              : Number(res?.statusCode) || 500;
          const errorMessage = err?.message ? String(err.message) : String(err);
          void writeLog(user, {
            statusCode,
            durationMs: Date.now() - startedAt,
            errorMessage,
          });
          return throwError(() => err);
        }),
      ),
    );
  }
}
