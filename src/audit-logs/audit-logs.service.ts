import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage } from 'mongoose';
import { PaginationResult, parsePagination } from '../common/pagination';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

const ITEM_CREATE_PATH_REGEX = /^\/items(?:\?.*)?$/;
const ITEM_UPDATE_PATH_REGEX = /^\/items\/[^/?]+(?:\?.*)?$/;
const ITEM_STOCK_PATH_REGEX = /^\/items\/[^/?]+\/stock(?:\?.*)?$/;
const ITEM_DELETE_PATH_REGEX = /^\/items\/[^/?]+(?:\?.*)?$/;

export type ItemStockAuditLog = AuditLog & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  itemId?: string;
  storeId?: string;
  storeName?: string;
  stockAction: 'created' | 'updated';
  beforeStock?: number;
  afterStock?: number;
  beforeTrackStock?: boolean;
  afterTrackStock?: boolean;
  user?: Record<string, unknown>;
  item?: Record<string, unknown>;
};

export type DeletedItemAuditLog = AuditLog & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  itemId?: string;
  itemName?: string;
  storeId?: string;
  storeName?: string;
  action: 'deleted';
  user?: Record<string, unknown>;
  item?: Record<string, unknown>;
};

export type ItemCrudAuditLog = {
  id: string;
  itemId?: string;
  itemName?: string;
  storeId?: string;
  storeName?: string;
  userId?: string;
  userName?: string;
  action: 'created' | 'updated' | 'deleted';
  createdAt?: Date;
};

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(entry: Omit<AuditLog, never>) {
    return this.auditLogModel.create(entry);
  }

  async findItemCrudLogs(query?: any): Promise<PaginationResult<ItemCrudAuditLog>> {
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 1000,
      maxLimit: 1000,
    });
    const pipeline = this.buildItemCrudLogsPipeline(query, skip, limit);
    const [result] = await this.auditLogModel.aggregate(pipeline).exec();
    const rows = Array.isArray(result?.data) ? result.data : [];
    const total = Number(result?.total?.[0]?.count ?? 0);
    const data = rows.map((row) => this.mapItemCrudAuditLog(row as any));

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
    };
  }

  async findItemStockChanges(query?: any): Promise<PaginationResult<ItemStockAuditLog>> {
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 20,
      maxLimit: 200,
    });
    const pipeline = this.buildItemStockChangesPipeline(query, skip, limit);
    const [result] = await this.auditLogModel.aggregate(pipeline).exec();
    const rows = Array.isArray(result?.data) ? result.data : [];
    const total = Number(result?.total?.[0]?.count ?? 0);
    const data = rows.map((row) => this.mapItemStockAuditLog(row as any));

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
    };
  }

  async findDeletedItems(query?: any): Promise<PaginationResult<DeletedItemAuditLog>> {
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 20,
      maxLimit: 200,
    });
    const pipeline = this.buildDeletedItemsPipeline(query, skip, limit);
    const [result] = await this.auditLogModel.aggregate(pipeline).exec();
    const rows = Array.isArray(result?.data) ? result.data : [];
    const total = Number(result?.total?.[0]?.count ?? 0);
    const data = rows.map((row) => this.mapDeletedItemAuditLog(row as any));

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
    };
  }

  private buildItemStockChangesPipeline(
    query: any,
    skip: number,
    limit: number,
  ): PipelineStage[] {
    const pipeline: PipelineStage[] = [
      {
        $match: this.buildItemStockChangesMatch(query),
      },
      {
        $addFields: {
          itemId: { $ifNull: ['$params.id', '$resourceId'] },
          stockAction: {
            $cond: [{ $eq: ['$method', 'POST'] }, 'created', 'updated'],
          },
        },
      },
    ];

    const itemId =
      typeof query?.itemId === 'string' ? query.itemId.trim() : '';
    if (itemId) {
      pipeline.push({
        $match: { itemId },
      });
    }

    pipeline.push(
      { $sort: { timestamp: -1, createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                let: { auditUserId: '$userId' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: '$_id' }, '$$auditUserId'],
                      },
                    },
                  },
                  {
                    $project: {
                      passwordHash: 0,
                      pos_pin: 0,
                      __v: 0,
                    },
                  },
                ],
                as: 'user',
              },
            },
            {
              $lookup: {
                from: 'items',
                let: { auditItemId: '$itemId' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: '$_id' }, '$$auditItemId'],
                      },
                    },
                  },
                  {
                    $project: {
                      __v: 0,
                    },
                  },
                ],
                as: 'item',
              },
            },
            {
              $addFields: {
                user: { $arrayElemAt: ['$user', 0] },
                item: { $arrayElemAt: ['$item', 0] },
              },
            },
            {
              $lookup: {
                from: 'stores',
                let: {
                  auditStoreId: { $ifNull: ['$storeId', '$item.storeId'] },
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: '$_id' }, '$$auditStoreId'],
                      },
                    },
                  },
                  {
                    $project: {
                      __v: 0,
                    },
                  },
                ],
                as: 'store',
              },
            },
            {
              $addFields: {
                store: { $arrayElemAt: ['$store', 0] },
                storeId: { $ifNull: ['$storeId', '$item.storeId'] },
                storeName: { $ifNull: ['$storeName', '$store.name'] },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    );

    return pipeline;
  }

  private buildItemCrudLogsPipeline(
    query: any,
    skip: number,
    limit: number,
  ): PipelineStage[] {
    const pipeline: PipelineStage[] = [
      {
        $match: this.buildItemCrudLogsMatch(query),
      },
      {
        $addFields: {
          action: {
            $ifNull: [
              '$action',
              {
                $switch: {
                  branches: [
                    { case: { $eq: ['$method', 'POST'] }, then: 'created' },
                    { case: { $eq: ['$method', 'DELETE'] }, then: 'deleted' },
                  ],
                  default: 'updated',
                },
              },
            ],
          },
          itemId: {
            $ifNull: ['$itemId', { $ifNull: ['$params.id', '$resourceId'] }],
          },
          itemName: {
            $ifNull: [
              '$itemName',
              { $ifNull: ['$resourceName', '$body.name'] },
            ],
          },
        },
      },
    ];

    const itemId =
      typeof query?.itemId === 'string' ? query.itemId.trim() : '';
    if (itemId) {
      pipeline.push({ $match: { itemId } });
    }

    const action = this.parseItemCrudAction(query?.action);
    if (action) {
      pipeline.push({ $match: { action } });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'items',
          let: { auditItemId: '$itemId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: '$_id' }, '$$auditItemId'],
                },
              },
            },
            {
              $project: {
                name: 1,
                storeId: 1,
              },
            },
          ],
          as: 'item',
        },
      },
      {
        $addFields: {
          item: { $arrayElemAt: ['$item', 0] },
          itemName: { $ifNull: ['$itemName', '$item.name'] },
          storeId: { $ifNull: ['$storeId', '$item.storeId'] },
        },
      },
    );

    const storeId =
      typeof query?.storeId === 'string' ? query.storeId.trim() : '';
    if (storeId) {
      pipeline.push({ $match: { storeId } });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'stores',
          let: {
            auditStoreId: {
              $convert: {
                input: {
                  $cond: [
                    { $isArray: '$storeId' },
                    { $arrayElemAt: ['$storeId', 0] },
                    '$storeId',
                  ],
                },
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: '$_id' }, '$$auditStoreId'],
                },
              },
            },
            {
              $project: {
                name: 1,
              },
            },
          ],
          as: 'store',
        },
      },
      {
        $lookup: {
          from: 'users',
          let: { auditUserId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: '$_id' }, '$$auditUserId'],
                },
              },
            },
            {
              $project: {
                name: 1,
              },
            },
          ],
          as: 'user',
        },
      },
      {
        $addFields: {
          store: { $arrayElemAt: ['$store', 0] },
          user: { $arrayElemAt: ['$user', 0] },
          storeName: { $ifNull: ['$storeName', '$store.name'] },
          userName: { $ifNull: ['$userName', '$user.name'] },
          createdAtForReport: { $ifNull: ['$createdAt', '$timestamp'] },
        },
      },
      { $sort: { createdAtForReport: -1, timestamp: -1, _id: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    );

    return pipeline;
  }

  private buildDeletedItemsPipeline(
    query: any,
    skip: number,
    limit: number,
  ): PipelineStage[] {
    const pipeline: PipelineStage[] = [
      {
        $match: this.buildDeletedItemsMatch(query),
      },
      {
        $addFields: {
          itemId: { $ifNull: ['$params.id', '$resourceId'] },
          itemName: { $ifNull: ['$resourceName', '$body.name'] },
          action: 'deleted',
        },
      },
    ];

    const itemId =
      typeof query?.itemId === 'string' ? query.itemId.trim() : '';
    if (itemId) {
      pipeline.push({
        $match: { itemId },
      });
    }

    pipeline.push(
      { $sort: { timestamp: -1, createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                let: { auditUserId: '$userId' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: '$_id' }, '$$auditUserId'],
                      },
                    },
                  },
                  {
                    $project: {
                      passwordHash: 0,
                      pos_pin: 0,
                      __v: 0,
                    },
                  },
                ],
                as: 'user',
              },
            },
            {
              $lookup: {
                from: 'items',
                let: { auditItemId: '$itemId' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: '$_id' }, '$$auditItemId'],
                      },
                    },
                  },
                  {
                    $project: {
                      __v: 0,
                    },
                  },
                ],
                as: 'item',
              },
            },
            {
              $addFields: {
                user: { $arrayElemAt: ['$user', 0] },
                item: { $arrayElemAt: ['$item', 0] },
                itemName: { $ifNull: ['$itemName', '$item.name'] },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    );

    return pipeline;
  }

  private buildItemCrudLogsMatch(
    query?: any,
  ): FilterQuery<AuditLogDocument> {
    const action = this.parseItemCrudAction(query?.action);
    const pathFilters: FilterQuery<AuditLogDocument>[] =
      action === 'created'
        ? [{ method: 'POST', path: ITEM_CREATE_PATH_REGEX }]
        : action === 'updated'
          ? [{ method: { $in: ['PATCH', 'PUT'] }, path: ITEM_UPDATE_PATH_REGEX }]
          : action === 'deleted'
            ? [{ method: 'DELETE', path: ITEM_DELETE_PATH_REGEX }]
            : [
                { method: 'POST', path: ITEM_CREATE_PATH_REGEX },
                {
                  method: { $in: ['PATCH', 'PUT'] },
                  path: ITEM_UPDATE_PATH_REGEX,
                },
                { method: 'DELETE', path: ITEM_DELETE_PATH_REGEX },
              ];

    const filters: FilterQuery<AuditLogDocument>[] = [
      { $or: pathFilters },
      {
        $or: [
          { statusCode: { $gte: 200, $lt: 300 } },
          { statusCode: { $exists: false } },
        ],
      },
    ];

    const userId =
      typeof query?.userId === 'string' ? query.userId.trim() : '';
    if (userId) {
      filters.push({ userId });
    }

    const from = this.parseDate(query?.from ?? query?.startDate);
    const to = this.parseDate(query?.to ?? query?.endDate, true);
    if (from || to) {
      const timestamp: Record<string, Date> = {};
      if (from) timestamp.$gte = from;
      if (to) timestamp.$lte = to;
      filters.push({ timestamp });
    }

    return filters.length === 1 ? filters[0] : { $and: filters };
  }

  private buildItemStockChangesMatch(
    query?: any,
  ): FilterQuery<AuditLogDocument> {
    const filters: FilterQuery<AuditLogDocument>[] = [
      {
        $or: [
          {
            method: 'POST',
            path: ITEM_CREATE_PATH_REGEX,
            $or: [
              { 'body.inStock': { $exists: true } },
              { 'body.trackStock': { $exists: true } },
            ],
          },
          {
            method: { $in: ['PATCH', 'PUT'] },
            path: ITEM_UPDATE_PATH_REGEX,
            $or: [
              { 'body.inStock': { $exists: true } },
              { 'body.trackStock': { $exists: true } },
            ],
          },
          {
            method: 'PATCH',
            path: ITEM_STOCK_PATH_REGEX,
          },
        ],
      },
    ];

    const userId =
      typeof query?.userId === 'string' ? query.userId.trim() : '';
    if (userId) {
      filters.push({ userId });
    }

    const from = this.parseDate(query?.from ?? query?.startDate);
    const to = this.parseDate(query?.to ?? query?.endDate, true);
    if (from || to) {
      const timestamp: Record<string, Date> = {};
      if (from) timestamp.$gte = from;
      if (to) timestamp.$lte = to;
      filters.push({ timestamp });
    }

    return filters.length === 1 ? filters[0] : { $and: filters };
  }

  private buildDeletedItemsMatch(
    query?: any,
  ): FilterQuery<AuditLogDocument> {
    const filters: FilterQuery<AuditLogDocument>[] = [
      {
        method: 'DELETE',
        path: ITEM_DELETE_PATH_REGEX,
      },
    ];

    const userId =
      typeof query?.userId === 'string' ? query.userId.trim() : '';
    if (userId) {
      filters.push({ userId });
    }

    const from = this.parseDate(query?.from ?? query?.startDate);
    const to = this.parseDate(query?.to ?? query?.endDate, true);
    if (from || to) {
      const timestamp: Record<string, Date> = {};
      if (from) timestamp.$gte = from;
      if (to) timestamp.$lte = to;
      filters.push({ timestamp });
    }

    return filters.length === 1 ? filters[0] : { $and: filters };
  }

  private parseDate(value: unknown, endOfDay = false): Date | undefined {
    if (typeof value !== 'string') return undefined;
    const raw = value.trim();
    if (!raw) return undefined;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsed = new Date(
        `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`,
      );
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return undefined;

    return parsed;
  }

  private parseItemCrudAction(
    value: unknown,
  ): 'created' | 'updated' | 'deleted' | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    return normalized === 'created' ||
      normalized === 'updated' ||
      normalized === 'deleted'
      ? normalized
      : undefined;
  }

  private mapItemCrudAuditLog(row: Record<string, any>): ItemCrudAuditLog {
    const createdAt = row?.createdAtForReport ?? row?.createdAt ?? row?.timestamp;
    const itemId = this.normalizeReportString(row?.itemId);
    const storeName = this.normalizeReportString(
      row?.storeName ?? row?.store?.name,
    );

    return {
      id:
        row?._id === undefined || row?._id === null
          ? ''
          : String(row._id).trim(),
      itemId,
      itemName: this.normalizeReportString(row?.itemName),
      storeId: this.normalizeReportString(row?.storeId),
      storeName,
      userId: this.normalizeReportString(row?.userId),
      userName: this.normalizeReportString(row?.userName),
      action: this.parseItemCrudAction(row?.action) ?? 'updated',
      createdAt:
        createdAt === undefined || createdAt === null
          ? undefined
          : new Date(createdAt),
    };
  }

  private normalizeReportString(value: unknown) {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim();
    return normalized && normalized !== '[object Object]'
      ? normalized
      : undefined;
  }

  private mapItemStockAuditLog(row: Record<string, any>): ItemStockAuditLog {
    const rawItemId = row?.itemId ?? row?.params?.id ?? row?.resourceId;
    const itemId =
      rawItemId === undefined || rawItemId === null
        ? undefined
        : String(rawItemId).trim() || undefined;

    return {
      ...(row as AuditLog),
      itemId,
      stockAction: row?.method === 'POST' ? 'created' : 'updated',
      beforeStock:
        typeof row?.beforeStock === 'number' ? row.beforeStock : undefined,
      afterStock:
        typeof row?.afterStock === 'number' ? row.afterStock : undefined,
      beforeTrackStock:
        typeof row?.beforeTrackStock === 'boolean'
          ? row.beforeTrackStock
          : undefined,
      afterTrackStock:
        typeof row?.afterTrackStock === 'boolean'
          ? row.afterTrackStock
          : undefined,
      storeId:
        row?.storeId === undefined || row?.storeId === null
          ? undefined
          : String(row.storeId).trim() || undefined,
      storeName:
        row?.storeName === undefined || row?.storeName === null
          ? undefined
          : String(row.storeName).trim() || undefined,
      user:
        row?.user && typeof row.user === 'object' && !Array.isArray(row.user)
          ? row.user
          : undefined,
      item:
        row?.item && typeof row.item === 'object' && !Array.isArray(row.item)
          ? row.item
          : undefined,
    };
  }

  private mapDeletedItemAuditLog(
    row: Record<string, any>,
  ): DeletedItemAuditLog {
    const rawItemId = row?.itemId ?? row?.params?.id ?? row?.resourceId;
    const itemId =
      rawItemId === undefined || rawItemId === null
        ? undefined
        : String(rawItemId).trim() || undefined;
    const rawItemName = row?.itemName ?? row?.resourceName ?? row?.item?.name;
    const itemName =
      rawItemName === undefined || rawItemName === null
        ? undefined
        : String(rawItemName).trim() || undefined;
    const rawStoreId = row?.storeId ?? row?.item?.storeId;
    const storeId =
      rawStoreId === undefined || rawStoreId === null
        ? undefined
        : String(rawStoreId).trim() || undefined;
    const rawStoreName =
      row?.storeName ?? row?.store?.name ?? row?.item?.store?.name;
    const storeName =
      rawStoreName === undefined || rawStoreName === null
        ? undefined
        : String(rawStoreName).trim() || undefined;

    return {
      ...(row as AuditLog),
      itemId,
      itemName,
      storeId,
      storeName,
      action: 'deleted',
      user:
        row?.user && typeof row.user === 'object' && !Array.isArray(row.user)
          ? row.user
          : undefined,
      item:
        row?.item && typeof row.item === 'object' && !Array.isArray(row.item)
          ? row.item
          : undefined,
    };
  }
}
