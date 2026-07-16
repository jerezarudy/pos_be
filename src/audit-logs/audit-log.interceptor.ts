import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditLogsService } from './audit-logs.service';
import { requestContext } from '../common/request-context';
import { Item, ItemDocument } from '../items/schemas/item.schema';
import { Store, StoreDocument } from '../stores/schemas/store.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'pos_pin',
  'authorization',
  'access_token',
  'refresh_token',
  'token',
]);

const ITEM_CREATE_PATH_REGEX = /^\/items(?:\?.*)?$/;
const ITEM_UPDATE_PATH_REGEX = /^\/items\/[^/?]+(?:\?.*)?$/;
const ITEM_STOCK_PATH_REGEX = /^\/items\/[^/?]+\/stock(?:\?.*)?$/;
const ITEM_DELETE_PATH_REGEX = /^\/items\/[^/?]+(?:\?.*)?$/;

type StockSnapshot = {
  stock?: number;
  trackStock?: boolean;
};

type ItemAuditContext = {
  resourceId?: string;
  resourceName?: string;
  storeId?: string;
  storeName?: string;
  stockSnapshot: StockSnapshot;
};

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

function extractResourceId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const raw = record._id ?? record.id;
  if (raw === undefined || raw === null) {
    return extractResourceId(record._doc);
  }

  const normalized = String(raw).trim();
  return normalized || undefined;
}

function extractResourceName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const raw = record.name ?? record.title ?? record.label;
  if (raw === undefined || raw === null) {
    return extractResourceName(record._doc);
  }

  const normalized = String(raw).trim();
  return normalized || undefined;
}

function extractStoreId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const raw = record.storeId;
  if (raw === undefined || raw === null) {
    return extractStoreId(record._doc);
  }

  const normalized = String(raw).trim();
  return normalized || undefined;
}

function extractStoreName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const raw = record.name ?? record.title ?? record.label;
  if (raw === undefined || raw === null) return undefined;

  const normalized = String(raw).trim();
  return normalized || undefined;
}

function hasOwn(obj: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function extractStockSnapshot(
  value: unknown,
): StockSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const snapshot: StockSnapshot = {};

  if (hasOwn(record, 'inStock')) {
    const rawStock = record.inStock;
    const stock =
      typeof rawStock === 'number'
        ? rawStock
        : rawStock === null || rawStock === undefined || rawStock === ''
          ? undefined
          : Number(rawStock);
    if (stock !== undefined && Number.isFinite(stock)) {
      snapshot.stock = stock;
    }
  }

  if (hasOwn(record, 'trackStock') && typeof record.trackStock === 'boolean') {
    snapshot.trackStock = record.trackStock;
  }

  return snapshot;
}

function isStockAuditRequest(method: string, path: string, body: unknown) {
  const normalizedBody =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  const touchesStock =
    !!normalizedBody &&
    (hasOwn(normalizedBody, 'inStock') || hasOwn(normalizedBody, 'trackStock'));

  return (
    (method === 'POST' && ITEM_CREATE_PATH_REGEX.test(path) && touchesStock) ||
    ((method === 'PATCH' || method === 'PUT') &&
      ITEM_UPDATE_PATH_REGEX.test(path) &&
      touchesStock) ||
    (method === 'PATCH' && ITEM_STOCK_PATH_REGEX.test(path))
  );
}

function isItemDeleteRequest(method: string, path: string) {
  return method === 'DELETE' && ITEM_DELETE_PATH_REGEX.test(path);
}

function getItemCrudAction(
  method: string,
  path: string,
): 'created' | 'updated' | 'deleted' | undefined {
  if (method === 'POST' && ITEM_CREATE_PATH_REGEX.test(path)) return 'created';
  if (
    (method === 'PATCH' || method === 'PUT') &&
    ITEM_UPDATE_PATH_REGEX.test(path)
  ) {
    return 'updated';
  }
  if (isItemDeleteRequest(method, path)) return 'deleted';
  return undefined;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLogsService: AuditLogsService,
    @InjectModel(Item.name)
    private readonly itemModel: Model<ItemDocument>,
    @InjectModel(Store.name)
    private readonly storeModel: Model<StoreDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
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
      const directUserName = req?.user?.name ? String(req.user.name) : undefined;
      if (directUserId || directUserRole || directUserName) {
        return {
          userId: directUserId,
          userName: directUserName,
          userRole: directUserRole,
        };
      }

      const authHeader: string | undefined =
        req?.headers?.authorization ?? req?.headers?.Authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return { userId: undefined, userName: undefined, userRole: undefined };
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const parts = token.split('.');
      if (parts.length < 2) {
        return { userId: undefined, userName: undefined, userRole: undefined };
      }

      try {
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload: any = JSON.parse(payloadJson);
        return {
          userId: payload?.sub ? String(payload.sub) : undefined,
          userName: payload?.name ? String(payload.name) : undefined,
          userRole: payload?.role ? String(payload.role) : undefined,
        };
      } catch {
        return { userId: undefined, userName: undefined, userRole: undefined };
      }
    };

    const params = sanitize(req?.params) as Record<string, unknown> | undefined;
    const query = sanitize(req?.query) as Record<string, unknown> | undefined;
    const body = sanitize(req?.body);
    const stockAuditRequest = isStockAuditRequest(method, path, body);
    const itemCrudAction = getItemCrudAction(method, path);
    const requestedItemId =
      typeof req?.params?.id === 'string' ? req.params.id.trim() : undefined;
    const beforeItemPromise: Promise<ItemAuditContext> =
      (stockAuditRequest || itemCrudAction) && requestedItemId
        ? this.itemModel
            .findById(requestedItemId)
            .select({ name: 1, storeId: 1, inStock: 1, trackStock: 1 })
            .lean()
            .exec()
            .then(async (item) => {
              const storeId = extractStoreId(item);
              const store =
                storeId !== undefined
                  ? await this.storeModel
                      .findById(storeId)
                      .select({ name: 1 })
                      .lean()
                      .exec()
                      .catch(() => undefined)
                  : undefined;

              return {
                resourceId: extractResourceId(item),
                resourceName: extractResourceName(item),
                storeId,
                storeName: extractStoreName(store),
                stockSnapshot: extractStockSnapshot(item),
              };
            })
            .catch(
              () =>
                ({
                  stockSnapshot: {},
                }) as ItemAuditContext,
            )
        : Promise.resolve({
            stockSnapshot: {},
          } as ItemAuditContext);
    let resourceId: string | undefined;
    let resourceName: string | undefined;
    let resolvedStoreId: string | undefined = extractStoreId(body);
    let resolvedStoreName: string | undefined = itemCrudAction
      ? undefined
      : extractStoreName(body);
    let afterSnapshot: StockSnapshot = {};

    const writeLog = async (
      user: { userId?: string; userName?: string; userRole?: string },
      data: {
        statusCode?: number;
        durationMs?: number;
        errorMessage?: string;
      },
    ) => {
      try {
        const beforeItem = await beforeItemPromise;
        const beforeSnapshot = beforeItem.stockSnapshot;
        const storeId = resolvedStoreId ?? beforeItem.storeId;
        let storeName = resolvedStoreName ?? beforeItem.storeName;
        let userName = user.userName;
        if (storeId && !storeName) {
          storeName = await this.storeModel
            .findById(storeId)
            .select({ name: 1 })
            .lean()
            .exec()
            .then((store) => extractStoreName(store))
            .catch(() => undefined);
        }
        if (itemCrudAction && user.userId && !userName) {
          userName = await this.userModel
            .findById(user.userId)
            .select({ name: 1 })
            .lean()
            .exec()
            .then((foundUser) => extractResourceName(foundUser))
            .catch(() => undefined);
        }
        const itemId = resourceId ?? beforeItem.resourceId;
        const itemName = resourceName ?? beforeItem.resourceName;
        await this.auditLogsService.create({
          timestamp,
          method,
          path,
          statusCode: data.statusCode,
          durationMs: data.durationMs,
          ip: ip || undefined,
          userAgent: userAgent || undefined,
          userId: user.userId,
          userName,
          userRole: user.userRole,
          action: itemCrudAction,
          itemId: itemCrudAction ? itemId : undefined,
          itemName: itemCrudAction ? itemName : undefined,
          resourceId: itemId,
          resourceName: itemName,
          beforeStock: isFiniteNumber(beforeSnapshot.stock)
            ? beforeSnapshot.stock
            : undefined,
          afterStock: isFiniteNumber(afterSnapshot.stock)
            ? afterSnapshot.stock
            : undefined,
          beforeTrackStock:
            typeof beforeSnapshot.trackStock === 'boolean'
              ? beforeSnapshot.trackStock
              : undefined,
          afterTrackStock:
            typeof afterSnapshot.trackStock === 'boolean'
              ? afterSnapshot.trackStock
              : undefined,
          storeId,
          storeName,
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
          next: (responseBody) => {
            const sanitizedResponseBody = sanitize(responseBody);
            resourceId = extractResourceId(sanitizedResponseBody);
            resourceName =
              extractResourceName(sanitizedResponseBody) ??
              (itemCrudAction ? extractResourceName(body) : undefined);
            const responseStoreId = extractStoreId(sanitizedResponseBody);
            const responseStoreName = extractStoreName(sanitizedResponseBody);
            const requestStoreId = extractStoreId(body);
            const requestStoreName = itemCrudAction
              ? undefined
              : extractStoreName(body);
            if (responseStoreId || requestStoreId) {
              resolvedStoreId = responseStoreId ?? requestStoreId;
            }
            if (!itemCrudAction && (responseStoreName || requestStoreName)) {
              resolvedStoreName = responseStoreName ?? requestStoreName;
            }
            afterSnapshot = extractStockSnapshot(sanitizedResponseBody);
          },
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
