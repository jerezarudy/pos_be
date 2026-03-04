import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { ClientSession } from 'mongoose';
import type { PipelineStage } from 'mongoose';
import { ItemsService } from '../items/items.service';
import { UsersService } from '../users/users.service';
import { PaginationResult, parsePagination } from '../common/pagination';
import type {
  SalesByCategoryRow,
  SalesByEmployeeRow,
  SalesByItemRow,
  SalesByPaymentTypeRow,
  SalesItemSeries,
  SalesReportBucket,
} from './dto/sales-reports.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { Sale, SaleDocument } from './schemas/sale.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import {
  ReceiptCounter,
  ReceiptCounterDocument,
} from './schemas/receipt-counter.schema';

function isObjectIdLike(value: string) {
  return /^[a-f\d]{24}$/i.test(value);
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

@Injectable()
export class SalesService {
  constructor(
    @InjectModel(Sale.name)
    private readonly saleModel: Model<SaleDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(ReceiptCounter.name)
    private readonly receiptCounterModel: Model<ReceiptCounterDocument>,
    private readonly usersService: UsersService,
    private readonly itemsService: ItemsService,
  ) {}

  private assertStoreId(storeId?: string) {
    const normalized = storeId?.trim();
    if (!normalized) {
      throw new BadRequestException('User has no assigned storeId');
    }
    return normalized;
  }

  private normalizeEmail(value: unknown) {
    const raw = typeof value === 'string' ? value : '';
    const email = raw.trim().toLowerCase();
    return email || undefined;
  }

  private getLocalDayKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private async nextReceiptNumber(storeId: string, session: ClientSession) {
    const dayKey = this.getLocalDayKey(new Date());

    const counter = await this.receiptCounterModel
      .findOneAndUpdate(
        { storeId, dayKey },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session },
      )
      .exec();

    const seq = Number(counter?.seq ?? 0);
    if (!Number.isFinite(seq) || seq <= 0) {
      throw new BadRequestException('Failed to generate receipt number');
    }

    return `${dayKey}${String(seq).padStart(6, '0')}`;
  }

  private parseDate(value: unknown, opts?: { endOfDay?: boolean }): Date {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) throw new BadRequestException('from/to is required');

    if (isDateOnly(raw)) {
      const iso = opts?.endOfDay
        ? `${raw}T23:59:59.999Z`
        : `${raw}T00:00:00.000Z`;
      const parsed = new Date(iso);
      if (!Number.isFinite(parsed.getTime())) {
        throw new BadRequestException(`Invalid date: ${raw}`);
      }
      return parsed;
    }

    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) {
      throw new BadRequestException(`Invalid date: ${raw}`);
    }
    return parsed;
  }

  private parseReportRange(query: any): { from: Date; to: Date } {
    const from = this.parseDate(query?.from ?? query?.start);
    const to = this.parseDate(query?.to ?? query?.end, { endOfDay: true });
    if (from > to) throw new BadRequestException('from must be <= to');
    return { from, to };
  }

  private parseEmployeeId(query: any): string | undefined {
    const raw =
      typeof query?.employeeId === 'string'
        ? query.employeeId
        : typeof query?.cashierId === 'string'
          ? query.cashierId
          : '';
    const value = raw.trim();
    if (!value) return undefined;
    if (value.toLowerCase() === 'all') return undefined;
    return value;
  }

  private parseBucket(query: any): SalesReportBucket {
    const raw = typeof query?.bucket === 'string' ? query.bucket : '';
    const value = raw.trim().toLowerCase();
    if (value === 'week' || value === 'month') return value;
    return 'day';
  }

  private parseTop(query: any): number {
    const topNum = Number(query?.top ?? 5);
    const top = Number.isFinite(topNum) && topNum > 0 ? Math.floor(topNum) : 5;
    return Math.min(top, 25);
  }

  private baseMatchForReports(
    query: any,
    storeId?: string,
  ): { match: Record<string, unknown>; from: Date; to: Date } {
    const { from, to } = this.parseReportRange(query);

    const storeIdNormalized = storeId?.trim() || undefined;

    const match: Record<string, unknown> = {
      ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
      createdAt: { $gte: from, $lte: to },
    };

    const employeeId = this.parseEmployeeId(query);
    if (employeeId) match['cashier.id'] = employeeId;

    return { match, from, to };
  }

  private itemLineStages(): PipelineStage[] {
    const itemIdExpr = {
      $toString: {
        $ifNull: [
          '$items.itemId',
          {
            $ifNull: [
              '$items.id',
              {
                $ifNull: [
                  '$items._id',
                  {
                    $ifNull: [
                      '$items.itemId._id',
                      { $ifNull: ['$items.item._id', '$items.item.id'] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const qtyRawExpr = {
      $ifNull: [
        '$items.qty',
        {
          $ifNull: ['$items.quantity', { $ifNull: ['$items.count', 0] }],
        },
      ],
    };

    const num = (input: any) => ({
      $convert: { input, to: 'double', onError: 0, onNull: 0 },
    });

    const trimStr = (input: any) => ({
      $trim: { input: { $ifNull: [input, ''] } },
    });

    return [
      { $unwind: '$items' },
      {
        $addFields: {
          __itemIdStr: trimStr(itemIdExpr),
          __qtyNum: num(qtyRawExpr),
          __lineName: trimStr({
            $ifNull: ['$items.name', { $ifNull: ['$items.item.name', ''] }],
          }),
          __lineCategoryName: trimStr({
            $ifNull: [
              '$items.categoryName',
              { $ifNull: ['$items.category.name', ''] },
            ],
          }),
          __lineCategoryId: trimStr({
            $toString: {
              $ifNull: [
                '$items.categoryId',
                {
                  $ifNull: [
                    '$items.categoryId._id',
                    { $ifNull: ['$items.category._id', '$items.category.id'] },
                  ],
                },
              ],
            },
          }),
        },
      },
      {
        $addFields: {
          __qty: {
            $cond: [{ $gt: ['$__qtyNum', 0] }, { $toInt: '$__qtyNum' }, 0],
          },
          __itemObjectId: {
            $cond: [
              {
                $regexMatch: {
                  input: '$__itemIdStr',
                  regex: /^[a-fA-F0-9]{24}$/,
                },
              },
              { $toObjectId: '$__itemIdStr' },
              null,
            ],
          },
        },
      },
      { $match: { __qty: { $gt: 0 } } },
      {
        $lookup: {
          from: 'items',
          let: { itemId: '$__itemObjectId', storeId: '$storeId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$_id', '$$itemId'] },
                    { $eq: ['$storeId', '$$storeId'] },
                  ],
                },
              },
            },
            { $project: { name: 1, category: 1, categoryId: 1, price: 1, cost: 1 } },
          ],
          as: '__itemDoc',
        },
      },
      { $addFields: { __itemDoc: { $first: '$__itemDoc' } } },
      {
        $addFields: {
          __itemName: {
            $let: {
              vars: {
                line: '$__lineName',
                ref: { $ifNull: ['$__itemDoc.name', ''] },
              },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: '$$line' }, 0] },
                  '$$line',
                  {
                    $cond: [
                      { $gt: [{ $strLenCP: '$$ref' }, 0] },
                      '$$ref',
                      'Unknown item',
                    ],
                  },
                ],
              },
            },
          },
          __categoryId: {
            $let: {
              vars: {
                line: '$__lineCategoryId',
                ref: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: [
                          '$__itemDoc.category.id',
                          { $ifNull: ['$__itemDoc.categoryId', ''] },
                        ],
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: '$$line' }, 0] },
                  '$$line',
                  '$$ref',
                ],
              },
            },
          },
          __categoryNameLine: {
            $let: {
              vars: { line: '$__lineCategoryName' },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: '$$line' }, 0] },
                  '$$line',
                  undefined,
                ],
              },
            },
          },
          __unitPrice: num({
            $ifNull: [
              '$items.price',
              { $ifNull: ['$items.unitPrice', '$__itemDoc.price'] },
            ],
          }),
          __unitCost: num({
            $ifNull: [
              '$items.cost',
              { $ifNull: ['$items.unitCost', '$__itemDoc.cost'] },
            ],
          }),
          __lineDiscount: num({
            $ifNull: [
              '$items.discountAmount',
              { $ifNull: ['$items.discount', '$items.discountTotal'] },
            ],
          }),
          __lineGross: num({
            $ifNull: [
              '$items.grossTotal',
              {
                $ifNull: [
                  '$items.total',
                  { $ifNull: ['$items.amount', '$items.lineTotal'] },
                ],
              },
            ],
          }),
          __lineNet: num({
            $ifNull: [
              '$items.netTotal',
              { $ifNull: ['$items.net', '$items.netAmount'] },
            ],
          }),
        },
      },
      {
        $addFields: {
          __categoryObjectId: {
            $cond: [
              {
                $regexMatch: {
                  input: '$__categoryId',
                  regex: /^[a-fA-F0-9]{24}$/,
                },
              },
              { $toObjectId: '$__categoryId' },
              null,
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'categories',
          let: { categoryId: '$__categoryObjectId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$categoryId'] },
              },
            },
            { $project: { name: 1 } },
          ],
          as: '__categoryDoc',
        },
      },
      { $addFields: { __categoryDoc: { $first: '$__categoryDoc' } } },
      {
        $addFields: {
          __categoryName: {
            $let: {
              vars: {
                line: { $ifNull: ['$__categoryNameLine', ''] },
                ref: {
                  $trim: {
                    input: { $toString: { $ifNull: ['$__categoryDoc.name', ''] } },
                  },
                },
              },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: '$$line' }, 0] },
                  '$$line',
                  {
                    $cond: [
                      { $gt: [{ $strLenCP: '$$ref' }, 0] },
                      '$$ref',
                      undefined,
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          __grossSales: {
            $cond: [
              { $gt: ['$__lineGross', 0] },
              '$__lineGross',
              { $multiply: ['$__unitPrice', '$__qty'] },
            ],
          },
        },
      },
      {
        $addFields: {
          __netSales: {
            $max: [
              0,
              {
                $cond: [
                  { $gt: ['$__lineNet', 0] },
                  '$__lineNet',
                  { $subtract: ['$__grossSales', '$__lineDiscount'] },
                ],
              },
            ],
          },
          __costOfGoods: { $multiply: ['$__unitCost', '$__qty'] },
        },
      },
      {
        $addFields: {
          __grossProfit: { $subtract: ['$__netSales', '$__costOfGoods'] },
        },
      },
    ];
  }

  async create(dto: CreateSaleDto, user: any) {
    const storeId = this.assertStoreId(user?.storeId);
    const posId = String(dto?.id ?? '').trim();
    if (!posId) throw new BadRequestException('id is required');

    const items = Array.isArray(dto?.items) ? dto.items : [];
    if (items.length === 0) throw new BadRequestException('items is required');
    const discounts = Array.isArray(dto?.discounts) ? dto.discounts : [];

    const cashierId = String(user?.sub ?? '').trim();
    if (!cashierId) throw new BadRequestException('Missing cashier user id');

    const cashierEmail = this.normalizeEmail(user?.email);
    const cashierName = (await this.usersService.findOne(cashierId))?.name;

    const customerId =
      String(dto?.customerId ?? dto?.customer?.id ?? '').trim() || undefined;

    const email = this.normalizeEmail(dto?.email);

    const currency =
      typeof dto?.currency === 'string' && dto.currency.trim()
        ? dto.currency.trim()
        : 'PHP';

    const session: ClientSession = await this.saleModel.db.startSession();
    try {
      let createdSale: SaleDocument | undefined;
      await session.withTransaction(async () => {
        const receiptNumber = await this.nextReceiptNumber(storeId, session);
        const created = await this.saleModel.create(
          [
            {
              storeId,
              posId,
              receiptNumber,
              currency,
              customerId,
              email,
              customer: dto?.customer ?? undefined,
              discounts,
              items,
              payment: dto?.payment ?? undefined,
              totals: dto?.totals ?? undefined,
              cashier: {
                id: cashierId,
                name: cashierName,
                email: cashierEmail,
              },
            },
          ],
          { session },
        );
        createdSale = created[0];

        await this.itemsService.decrementStockForSale(items, storeId, {
          session,
          allowCrossStore: true,
        });
      });

      if (!createdSale) {
        throw new BadRequestException('Failed to create sale');
      }

      return createdSale;
    } catch (err: any) {
      if (err?.code === 11000) throw new ConflictException('Sale already exists');
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async findAll(query: any, storeId?: string): Promise<PaginationResult<Sale>> {
    const storeIdNormalized = this.assertStoreId(storeId);
    const { page, limit, skip } = parsePagination(query);

    const filter: any = { storeId: storeIdNormalized };

    const cashierId = this.parseEmployeeId(query);
    if (cashierId) {
      filter['cashier.id'] = cashierId;
    }

    const q = String(query?.q ?? '').trim();
    if (q) {
      filter.$or = [
        { posId: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { 'cashier.name': { $regex: q, $options: 'i' } },
        { 'cashier.email': { $regex: q, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.saleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.saleModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
    };
  }

  async findOne(idOrPosId: string, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
    const key = String(idOrPosId ?? '').trim();
    if (!key) throw new BadRequestException('id is required');

    const sale = await this.saleModel
      .findOne({
        storeId: storeIdNormalized,
        ...(isObjectIdLike(key) ? { _id: key } : { posId: key }),
      })
      .exec();

    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  async update(idOrPosId: string, dto: UpdateSaleDto, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
    const key = String(idOrPosId ?? '').trim();
    if (!key) throw new BadRequestException('id is required');

    const update: Record<string, unknown> = {
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
      ...(dto.customer !== undefined ? { customer: dto.customer } : {}),
      ...(dto.email !== undefined ? { email: this.normalizeEmail(dto.email) } : {}),
      ...(dto.discounts !== undefined ? { discounts: dto.discounts } : {}),
      ...(dto.items !== undefined ? { items: dto.items } : {}),
      ...(dto.payment !== undefined ? { payment: dto.payment } : {}),
      ...(dto.totals !== undefined ? { totals: dto.totals } : {}),
    };

    const updated = await this.saleModel
      .findOneAndUpdate(
        {
          storeId: storeIdNormalized,
          ...(isObjectIdLike(key) ? { _id: key } : { posId: key }),
        },
        update,
        { new: true },
      )
      .exec();

    if (!updated) throw new NotFoundException('Sale not found');
    return updated;
  }

  async reportByItem(
    query: any,
    storeId?: string,
  ): Promise<
    PaginationResult<SalesByItemRow> & {
      topItems: Pick<SalesByItemRow, 'itemId' | 'itemName' | 'netSales'>[];
      series: SalesItemSeries[];
      bucket: SalesReportBucket;
      from: string;
      to: string;
    }
  > {
    const { match, from, to } = this.baseMatchForReports(query, storeId);
    const bucket = this.parseBucket(query);
    const top = this.parseTop(query);
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 10,
      maxLimit: 200,
    });

    const normalizeItemKey = (itemId?: string, itemName?: string) => {
      const id = typeof itemId === 'string' ? itemId.trim() : '';
      if (id) return id;
      const name = typeof itemName === 'string' ? itemName.trim().toLowerCase() : '';
      return name;
    };

    const preGroupStages: PipelineStage[] = [
      {
        $addFields: {
          __itemIdLen: { $strLenCP: { $ifNull: ['$__itemIdStr', ''] } },
          __catNameLen: { $strLenCP: { $ifNull: ['$__categoryName', ''] } },
          __catIdLen: { $strLenCP: { $ifNull: ['$__categoryId', ''] } },
          __itemKey: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ['$__itemIdStr', ''] } }, 0] },
              '$__itemIdStr',
              { $toLower: { $ifNull: ['$__itemName', ''] } },
            ],
          },
        },
      },
      {
        $sort: {
          __itemIdLen: -1,
          __catNameLen: -1,
          __catIdLen: -1,
          __itemName: 1,
        },
      },
    ];

    const groupStage: PipelineStage.Group = {
      $group: {
        _id: '$__itemKey',
        itemId: { $first: '$__itemIdStr' },
        itemName: { $first: '$__itemName' },
        categoryId: { $first: '$__categoryId' },
        categoryName: { $first: '$__categoryName' },
        itemsSold: { $sum: '$__qty' },
        netSales: { $sum: '$__netSales' },
        costOfGoods: { $sum: '$__costOfGoods' },
        grossProfit: { $sum: '$__grossProfit' },
      },
    };

    const projectRow: PipelineStage.Project = {
      $project: {
        _id: 0,
        itemId: '$itemId',
        itemName: '$itemName',
        category: {
          id: '$categoryId',
          name: '$categoryName',
        },
        itemsSold: 1,
        netSales: 1,
        costOfGoods: 1,
        grossProfit: 1,
      },
    };

    const sortStage: PipelineStage.Sort = { $sort: { netSales: -1 } };

    const [tableResult, topRows] = await Promise.all([
      this.saleModel
        .aggregate([
          { $match: match },
          ...this.itemLineStages(),
          ...preGroupStages,
          groupStage,
          projectRow,
          sortStage,
          {
            $facet: {
              data: [{ $skip: skip }, { $limit: limit }],
              total: [{ $count: 'count' }],
            },
          },
        ])
        .exec(),
      this.saleModel
        .aggregate([
          { $match: match },
          ...this.itemLineStages(),
          ...preGroupStages,
          groupStage,
          projectRow,
          sortStage,
          { $limit: top },
        ])
        .exec(),
    ]);

    const facet = tableResult?.[0] ?? { data: [], total: [] };
    const data = (facet.data ?? []) as SalesByItemRow[];
    const total = Number(facet.total?.[0]?.count ?? 0);

    const topItems = (topRows as SalesByItemRow[]).map((r) => ({
      itemId: r.itemId,
      itemName: r.itemName,
      netSales: r.netSales,
    }));

    const topItemKeys = topItems
      .map((r) => normalizeItemKey(r.itemId, r.itemName))
      .filter((k) => !!k);

    const dateKey = {
      $dateTrunc: { date: '$createdAt', unit: bucket, timezone: 'UTC' },
    };

    const seriesRows: Array<{
      itemId?: string;
      itemName: string;
      key: string;
      x: string;
      y: number;
    }> = topItemKeys.length
      ? await this.saleModel
          .aggregate([
            { $match: match },
            ...this.itemLineStages(),
            ...preGroupStages,
            { $match: { __itemKey: { $in: topItemKeys } } },
            {
              $group: {
                _id: {
                  key: '$__itemKey',
                  date: dateKey,
                },
                itemId: { $first: '$__itemIdStr' },
                itemName: { $first: '$__itemName' },
                netSales: { $sum: '$__netSales' },
              },
            },
            {
              $project: {
                _id: 0,
                key: '$_id.key',
                itemId: '$itemId',
                itemName: '$itemName',
                x: {
                  $dateToString: {
                    date: '$_id.date',
                    timezone: 'UTC',
                    format: '%Y-%m-%d',
                  },
                },
                y: '$netSales',
              },
            },
            { $sort: { x: 1 } },
          ])
          .exec()
      : [];

    const seriesMap = new Map<string, SalesItemSeries>();
    for (const row of seriesRows) {
      const key = row.key;
      const existing =
        seriesMap.get(key) ??
        ({ itemId: row.itemId, itemName: row.itemName, points: [] } as SalesItemSeries);
      existing.points.push({ x: row.x, y: Number(row.y ?? 0) });
      seriesMap.set(key, existing as SalesItemSeries);
    }

    const series = Array.from(seriesMap.values());

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
      topItems,
      series,
      bucket,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async reportByCategory(
    query: any,
    storeId?: string,
  ): Promise<PaginationResult<SalesByCategoryRow> & { from: string; to: string }> {
    const { match, from, to } = this.baseMatchForReports(query, storeId);
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 10,
      maxLimit: 200,
    });

    const groupStage: PipelineStage.Group = {
      $group: {
        _id: {
          categoryId: '$__categoryId',
          categoryName: '$__categoryName',
        },
        itemsSold: { $sum: '$__qty' },
        netSales: { $sum: '$__netSales' },
        costOfGoods: { $sum: '$__costOfGoods' },
        grossProfit: { $sum: '$__grossProfit' },
      },
    };

    const projectRow: PipelineStage.Project = {
      $project: {
        _id: 0,
        category: {
          id: '$_id.categoryId',
          name: {
            $let: {
              vars: { name: { $ifNull: ['$_id.categoryName', ''] } },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: '$$name' }, 0] },
                  '$$name',
                  {
                    $cond: [
                      { $gt: [{ $strLenCP: '$_id.categoryId' }, 0] },
                      'Unlabeled',
                      'Uncategorized',
                    ],
                  },
                ],
              },
            },
          },
        },
        itemsSold: 1,
        netSales: 1,
        costOfGoods: 1,
        grossProfit: 1,
      },
    };

    const sortStage: PipelineStage.Sort = { $sort: { netSales: -1 } };

    const result = await this.saleModel
      .aggregate([
        { $match: match },
        ...this.itemLineStages(),
        groupStage,
        projectRow,
        sortStage,
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const facet = result?.[0] ?? { data: [], total: [] };
    const data = (facet.data ?? []) as SalesByCategoryRow[];
    const total = Number(facet.total?.[0]?.count ?? 0);

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async reportByPaymentType(
    query: any,
    storeId?: string,
  ): Promise<{ from: string; to: string; data: SalesByPaymentTypeRow[] }> {
    const { match, from, to } = this.baseMatchForReports(query, storeId);

    const num = (input: any) => ({
      $convert: { input, to: 'double', onError: 0, onNull: 0 },
    });

    const rows = (await this.saleModel
      .aggregate([
        { $match: match },
        {
          $addFields: {
            __paymentType: {
              $let: {
                vars: { t: { $trim: { input: { $ifNull: ['$payment.type', ''] } } } },
                in: {
                  $cond: [{ $gt: [{ $strLenCP: '$$t' }, 0] }, '$$t', 'Unknown'],
                },
              },
            },
            __amount: num({
              $ifNull: ['$totals.amountDue', { $ifNull: ['$totals.amountPaid', 0] }],
            }),
          },
        },
        {
          $group: {
            _id: '$__paymentType',
            paymentTransactions: { $sum: 1 },
            paymentAmount: { $sum: '$__amount' },
          },
        },
        {
          $project: {
            _id: 0,
            paymentType: '$_id',
            paymentTransactions: 1,
            paymentAmount: 1,
            refundTransactions: { $literal: 0 },
            refundAmount: { $literal: 0 },
            netAmount: '$paymentAmount',
          },
        },
        { $sort: { paymentAmount: -1 } },
      ])
      .exec()) as SalesByPaymentTypeRow[];

    return { from: from.toISOString(), to: to.toISOString(), data: rows };
  }

  async reportByEmployee(
    query: any,
    storeId?: string,
  ): Promise<{ from: string; to: string; data: SalesByEmployeeRow[] }> {
    const { match, from, to } = this.baseMatchForReports(query, storeId);
    const storeIdNormalized = storeId?.trim() || undefined;
    const employeeIdFilter = this.parseEmployeeId(query);

    const num = (input: any) => ({
      $convert: { input, to: 'double', onError: 0, onNull: 0 },
    });

    const [employeesFromSales, users] = await Promise.all([
      this.saleModel
      .aggregate([
        { $match: match },
        {
          $addFields: {
            __grossSales: num({
              $ifNull: [
                '$totals.amountDue',
                { $ifNull: ['$totals.amountPaid', 0] },
              ],
            }),
            __discounts: {
              $sum: {
                $map: {
                  input: { $ifNull: ['$discounts', []] },
                  as: 'd',
                  in: num({
                    $ifNull: [
                      '$$d.amount',
                      {
                        $ifNull: [
                          '$$d.value',
                          {
                            $ifNull: [
                              '$$d.discount',
                              { $ifNull: ['$$d.discountAmount', 0] },
                            ],
                          },
                        ],
                      },
                    ],
                  }),
                },
              },
            },
          },
        },
        {
          $group: {
            _id: {
              employeeId: '$cashier.id',
              name: '$cashier.name',
              email: '$cashier.email',
            },
            grossSales: { $sum: '$__grossSales' },
            discounts: { $sum: '$__discounts' },
            receipts: { $sum: 1 },
          },
        },
        {
          $addFields: {
            refunds: 0,
            netSales: { $subtract: ['$grossSales', '$discounts'] },
            averageSale: {
              $cond: [
                { $gt: ['$receipts', 0] },
                { $divide: [{ $subtract: ['$grossSales', '$discounts'] }, '$receipts'] },
                0,
              ],
            },
          },
        },
        {
          $project: {
            _id: 0,
            employeeId: '$_id.employeeId',
            name: '$_id.name',
            email: '$_id.email',
            grossSales: 1,
            refunds: 1,
            discounts: 1,
            netSales: 1,
            receipts: 1,
            averageSale: 1,
            customersSignedUp: { $literal: 0 },
          },
        },
        { $sort: { netSales: -1 } },
      ])
      .exec() as Promise<SalesByEmployeeRow[]>,
      this.usersService.listSalesEmployees({
        storeId: storeIdNormalized,
        userId: employeeIdFilter,
      }),
    ]);

    const employeesMap = new Map<string, SalesByEmployeeRow>();
    for (const u of users as any[]) {
      const id = String(u?._id ?? '').trim();
      if (!id) continue;
      employeesMap.set(id, {
        employeeId: id,
        name: u?.name,
        email: u?.email,
        grossSales: 0,
        refunds: 0,
        discounts: 0,
        netSales: 0,
        receipts: 0,
        averageSale: 0,
        customersSignedUp: 0,
      });
    }

    for (const e of employeesFromSales) {
      if (!e?.employeeId) continue;
      const existing = employeesMap.get(e.employeeId);
      employeesMap.set(e.employeeId, { ...(existing ?? e), ...e });
    }

    const employeeIds = Array.from(employeesMap.keys());

    if (employeeIds.length) {
      const customersByActor = await this.customerModel
        .aggregate([
          {
            $match: {
              ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
              createdAt: { $gte: from, $lte: to },
              createdBy: { $in: employeeIds },
            },
          },
          { $group: { _id: '$createdBy', count: { $sum: 1 } } },
        ])
        .exec();

      const signedUpMap = new Map<string, number>(
        customersByActor.map((r: any) => [String(r?._id ?? ''), Number(r?.count ?? 0)]),
      );

      for (const e of employeesMap.values()) {
        e.customersSignedUp = signedUpMap.get(e.employeeId) ?? 0;
      }
    }

    const data = Array.from(employeesMap.values()).sort((a, b) => {
      const diff = (b.netSales ?? 0) - (a.netSales ?? 0);
      if (diff !== 0) return diff;
      const an = (a.name ?? '').toLowerCase();
      const bn = (b.name ?? '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    return { from: from.toISOString(), to: to.toISOString(), data };
  }

  async reportReceipts(
    query: any,
    storeId?: string,
  ): Promise<
    PaginationResult<{
      id: string;
      receiptNo: string;
      date: string;
      employee?: string;
      customer?: string;
      type: 'Sale' | 'Refund';
      total: number;
      currency: string;
    }> & {
      from: string;
      to: string;
      summary: { allReceipts: number; sales: number; refunds: number };
    }
  > {
    const storeIdNormalized = storeId?.trim() || undefined;
    const { from, to } = this.parseReportRange(query);
    const employeeId = this.parseEmployeeId(query);
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 10,
      maxLimit: 200,
    });

    const filter: any = {
      ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
      createdAt: { $gte: from, $lte: to },
    };
    if (employeeId) filter['cashier.id'] = employeeId;

    const q = String(query?.q ?? '').trim();
    if (q) {
      filter.$or = [
        { posId: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { 'cashier.name': { $regex: q, $options: 'i' } },
        { 'cashier.email': { $regex: q, $options: 'i' } },
        { 'customer.name': { $regex: q, $options: 'i' } },
        { 'customer.email': { $regex: q, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      this.saleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select({
          _id: 1,
          posId: 1,
          receiptNumber: 1,
          createdAt: 1,
          currency: 1,
          cashier: 1,
          customer: 1,
          email: 1,
          totals: 1,
        })
        .exec(),
      this.saleModel.countDocuments(filter).exec(),
    ]);

    const data = docs.map((s: any) => {
      const totalNum =
        typeof s?.totals?.amountDue === 'number'
          ? s.totals.amountDue
          : typeof s?.totals?.amountPaid === 'number'
            ? s.totals.amountPaid
            : 0;

      const customerName =
        (typeof s?.customer?.name === 'string' && s.customer.name.trim()) ||
        (typeof s?.customer?.email === 'string' && s.customer.email.trim()) ||
        (typeof s?.email === 'string' && s.email.trim()) ||
        undefined;

      const employeeName =
        (typeof s?.cashier?.name === 'string' && s.cashier.name.trim()) ||
        (typeof s?.cashier?.email === 'string' && s.cashier.email.trim()) ||
        undefined;

      return {
        id: String(s?._id ?? ''),
        receiptNo: String(s?.receiptNumber ?? s?.posId ?? ''),
        date: new Date(s?.createdAt).toISOString(),
        employee: employeeName,
        customer: customerName,
        type: 'Sale' as const,
        total: totalNum,
        currency: String(s?.currency ?? 'PHP'),
      };
    });

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
      from: from.toISOString(),
      to: to.toISOString(),
      summary: { allReceipts: total, sales: total, refunds: 0 },
    };
  }
}
