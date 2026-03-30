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
  EndOfDayCashReport,
  SalesByCategoryRow,
  SalesByEmployeeRow,
  SalesByItemRow,
  SalesByPaymentTypeRow,
  SalesItemSeries,
  SalesReportBucket,
} from './dto/sales-reports.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { Sale, SaleDocument, SaleTransactionType } from './schemas/sale.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
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
  private supportsTransactionsCache: boolean | undefined;

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

  private async supportsTransactions() {
    if (this.supportsTransactionsCache !== undefined) {
      return this.supportsTransactionsCache;
    }

    try {
      // `model.db` is a Mongoose Connection; native driver Db is `connection.db`.
      const nativeDb: any = (this.saleModel.db as any)?.db;
      const cmd = async (command: Record<string, unknown>) =>
        nativeDb?.admin?.().command(command);

      const hello: any = await cmd({ hello: 1 });
      const res = hello ?? (await cmd({ isMaster: 1 }));

      this.supportsTransactionsCache =
        Boolean(res?.setName) || res?.msg === 'isdbgrid';
    } catch {
      this.supportsTransactionsCache = false;
    }

    return this.supportsTransactionsCache;
  }

  private assertStoreId(storeId?: string) {
    const normalized = storeId?.trim();
    if (!normalized) {
      throw new BadRequestException('storeId is required');
    }
    return normalized;
  }

  private buildSaleLookup(
    idOrPosId: string,
    storeId?: string,
    extraFilter?: Record<string, unknown>,
  ) {
    const key = String(idOrPosId ?? '').trim();
    if (!key) throw new BadRequestException('id is required');

    const storeIdNormalized = storeId?.trim() || undefined;
    return {
      ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
      ...(isObjectIdLike(key) ? { _id: key } : { posId: key }),
      ...(extraFilter ?? {}),
    };
  }

  private normalizeEmail(value: unknown) {
    const raw = typeof value === 'string' ? value : '';
    const email = raw.trim().toLowerCase();
    return email || undefined;
  }

  private normalizeReason(value: unknown) {
    const raw = typeof value === 'string' ? value : '';
    const reason = raw.trim();
    return reason || undefined;
  }

  private parseTransactionType(
    value: unknown,
  ): SaleTransactionType | undefined {
    const raw = typeof value === 'string' ? value : '';
    const normalized = raw.trim().toLowerCase();

    if (!normalized || normalized === 'all') return undefined;
    if (normalized === SaleTransactionType.Sale || normalized === 'sales') {
      return SaleTransactionType.Sale;
    }
    if (
      normalized === SaleTransactionType.Refund ||
      normalized === 'refunds' ||
      normalized === 'return'
    ) {
      return SaleTransactionType.Refund;
    }

    throw new BadRequestException('type must be sale or refund');
  }

  private parseTransactionTypeFromQuery(query: any) {
    return this.parseTransactionType(query?.transactionType ?? query?.type);
  }

  private toPositiveMoney(value: unknown) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return undefined;
    return Math.abs(num);
  }

  private cloneRefundTotals(totals?: any) {
    if (!totals) return undefined;

    return {
      ...totals,
      ...(totals?.amountDue !== undefined
        ? { amountDue: this.toPositiveMoney(totals.amountDue) }
        : {}),
      ...(totals?.amountPaid !== undefined
        ? { amountPaid: this.toPositiveMoney(totals.amountPaid) }
        : {}),
      ...(totals?.change !== undefined
        ? { change: this.toPositiveMoney(totals.change) }
        : {}),
    };
  }

  private buildRefundPosId(posId: unknown) {
    const normalized = String(posId ?? '').trim();
    if (!normalized) throw new BadRequestException('Sale is missing posId');
    return `${normalized}-refund`;
  }

  private async resolveCashier(user: any) {
    const cashierId = String(user?.sub ?? '').trim();
    if (!cashierId) throw new BadRequestException('Missing cashier user id');

    const cashierEmail = this.normalizeEmail(user?.email);
    const cashierName = (await this.usersService.findOne(cashierId))?.name;

    return {
      id: cashierId,
      name: cashierName,
      email: cashierEmail,
    };
  }

  private getLocalDayKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private async nextReceiptNumber(storeId: string, session?: ClientSession) {
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
    const from = this.parseDate(query?.from ?? query?.start ?? query?.startDate);
    const to = this.parseDate(query?.to ?? query?.end ?? query?.endDate, {
      endOfDay: true,
    });
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
    const transactionType = this.parseTransactionTypeFromQuery(query);

    const storeIdNormalized = storeId?.trim() || undefined;

    const match: Record<string, unknown> = {
      ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
      ...(transactionType ? { transactionType } : {}),
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
          __direction: {
            $cond: [
              { $eq: ['$transactionType', SaleTransactionType.Refund] },
              -1,
              1,
            ],
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
            {
              $project: {
                name: 1,
                category: 1,
                categoryId: 1,
                price: 1,
                cost: 1,
              },
            },
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
                    input: {
                      $toString: { $ifNull: ['$__categoryDoc.name', ''] },
                    },
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
      {
        $addFields: {
          __signedQty: { $multiply: ['$__qty', '$__direction'] },
          __signedGrossSales: { $multiply: ['$__grossSales', '$__direction'] },
          __signedNetSales: { $multiply: ['$__netSales', '$__direction'] },
          __signedCostOfGoods: {
            $multiply: ['$__costOfGoods', '$__direction'],
          },
          __signedGrossProfit: {
            $multiply: ['$__grossProfit', '$__direction'],
          },
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

    const cashier = await this.resolveCashier(user);

    const customerId =
      String(dto?.customerId ?? dto?.customer?.id ?? '').trim() || undefined;

    const email = this.normalizeEmail(dto?.email);

    const currency =
      typeof dto?.currency === 'string' && dto.currency.trim()
        ? dto.currency.trim()
        : 'PHP';

    try {
      const useTransactions = await this.supportsTransactions();

      if (!useTransactions) {
        const exists = await this.saleModel.exists({ storeId, posId }).exec();
        if (exists) throw new ConflictException('Sale already exists');

        await this.itemsService.decrementStockForSale(items, storeId, {
          allowCrossStore: true,
        });

        const receiptNumber = await this.nextReceiptNumber(storeId);

        return await this.saleModel.create({
          storeId,
          transactionType: SaleTransactionType.Sale,
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
          cashier,
        });
      }

      const session: ClientSession = await this.saleModel.db.startSession();
      try {
        let createdSale: SaleDocument | undefined;
        await session.withTransaction(async () => {
          const receiptNumber = await this.nextReceiptNumber(storeId, session);
          const created = await this.saleModel.create(
            [
              {
                storeId,
                transactionType: SaleTransactionType.Sale,
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
                cashier,
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
      } finally {
        await session.endSession();
      }
    } catch (err: any) {
      if (err?.code === 11000)
        throw new ConflictException('Sale already exists');
      throw err;
    }
  }

  async refund(
    idOrPosId: string,
    dto: RefundSaleDto,
    user: any,
    storeId?: string,
  ) {
    const refundReason = this.normalizeReason(dto?.reason);
    const cashier = await this.resolveCashier(user);
    const lookup = this.buildSaleLookup(idOrPosId, storeId, {
      transactionType: SaleTransactionType.Sale,
    });
    const useTransactions = await this.supportsTransactions();

    try {
      if (!useTransactions) {
        const sale = await this.saleModel.findOne(lookup).exec();
        if (!sale) throw new NotFoundException('Sale not found');
        if (sale.refundSaleId || sale.refundedAt) {
          throw new ConflictException('Sale already refunded');
        }

        await this.itemsService.incrementStockForSale(
          sale.items,
          sale.storeId,
          {
            allowCrossStore: true,
          },
        );

        const receiptNumber = await this.nextReceiptNumber(sale.storeId);
        const refund = await this.saleModel.create({
          storeId: sale.storeId,
          transactionType: SaleTransactionType.Refund,
          posId: this.buildRefundPosId(sale.posId),
          receiptNumber,
          currency: sale.currency ?? 'PHP',
          customerId: sale.customerId,
          sourceSaleId: String(sale._id),
          refundReason,
          email: sale.email,
          customer: sale.customer,
          discounts: sale.discounts ?? [],
          items: sale.items ?? [],
          payment: sale.payment ?? undefined,
          totals: this.cloneRefundTotals(sale.totals),
          cashier,
        });

        await this.saleModel
          .findByIdAndUpdate(sale._id, {
            refundSaleId: String(refund._id),
            refundedAt: new Date(),
            refundReason,
          })
          .exec();

        return refund;
      }

      const session: ClientSession = await this.saleModel.db.startSession();
      try {
        let refundDoc: SaleDocument | undefined;

        await session.withTransaction(async () => {
          const sale = await this.saleModel
            .findOne(lookup)
            .session(session)
            .exec();
          if (!sale) throw new NotFoundException('Sale not found');
          if (sale.refundSaleId || sale.refundedAt) {
            throw new ConflictException('Sale already refunded');
          }

          const receiptNumber = await this.nextReceiptNumber(
            sale.storeId,
            session,
          );
          const created = await this.saleModel.create(
            [
              {
                storeId: sale.storeId,
                transactionType: SaleTransactionType.Refund,
                posId: this.buildRefundPosId(sale.posId),
                receiptNumber,
                currency: sale.currency ?? 'PHP',
                customerId: sale.customerId,
                sourceSaleId: String(sale._id),
                refundReason,
                email: sale.email,
                customer: sale.customer,
                discounts: sale.discounts ?? [],
                items: sale.items ?? [],
                payment: sale.payment ?? undefined,
                totals: this.cloneRefundTotals(sale.totals),
                cashier,
              },
            ],
            { session },
          );
          refundDoc = created[0];

          await this.itemsService.incrementStockForSale(
            sale.items,
            sale.storeId,
            {
              session,
              allowCrossStore: true,
            },
          );

          await this.saleModel
            .findByIdAndUpdate(
              sale._id,
              {
                refundSaleId: String(refundDoc._id),
                refundedAt: new Date(),
                refundReason,
              },
              { session },
            )
            .exec();
        });

        if (!refundDoc) {
          throw new BadRequestException('Failed to create refund');
        }

        return refundDoc;
      } finally {
        await session.endSession();
      }
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('Sale already refunded');
      }
      throw err;
    }
  }

  async findAll(query: any, storeId?: string): Promise<PaginationResult<Sale>> {
    const { page, limit, skip } = parsePagination(query);
    const transactionType = this.parseTransactionTypeFromQuery(query);

    const storeIdNormalized = storeId?.trim() || undefined;
    const filter: any = {
      ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
      ...(transactionType ? { transactionType } : {}),
    };

    const startDate = query?.startDate ?? query?.from ?? query?.start;
    const endDate = query?.endDate ?? query?.to ?? query?.end;
    if (startDate !== undefined || endDate !== undefined) {
      if (!startDate || !endDate) {
        throw new BadRequestException('startDate/endDate is required');
      }

      const from = this.parseDate(startDate);
      const to = this.parseDate(endDate, { endOfDay: true });
      if (from > to) {
        throw new BadRequestException('startDate must be <= endDate');
      }

      filter.createdAt = { $gte: from, $lte: to };
    }

    const cashierId = this.parseEmployeeId(query);
    if (cashierId) {
      filter['cashier.id'] = cashierId;
    }

    const q = String(query?.q ?? '').trim();
    if (q) {
      const sourceSales = await this.saleModel
        .find({
          ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
          transactionType: SaleTransactionType.Sale,
          receiptNumber: { $regex: q, $options: 'i' },
        })
        .select({ _id: 1 })
        .lean()
        .exec();

      const sourceSaleIds = sourceSales.map((sale: any) => String(sale?._id ?? ''));

      filter.$or = [
        { posId: { $regex: q, $options: 'i' } },
        { receiptNumber: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { 'cashier.name': { $regex: q, $options: 'i' } },
        { 'cashier.email': { $regex: q, $options: 'i' } },
        ...(sourceSaleIds.length > 0
          ? [{ sourceSaleId: { $in: sourceSaleIds } }]
          : []),
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

    const refundSourceSaleIds = data
      .filter((sale: any) => sale?.transactionType === SaleTransactionType.Refund)
      .map((sale: any) => String(sale?.sourceSaleId ?? '').trim())
      .filter((id: string) => id.length > 0);

    const sourceReceiptMap =
      refundSourceSaleIds.length > 0
        ? new Map(
            (
              await this.saleModel
                .find({
                  ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
                  _id: { $in: refundSourceSaleIds },
                })
                .select({ _id: 1, receiptNumber: 1 })
                .lean()
                .exec()
            ).map((sale: any) => [
              String(sale?._id ?? ''),
              typeof sale?.receiptNumber === 'string'
                ? sale.receiptNumber
                : undefined,
            ]),
          )
        : new Map<string, string | undefined>();

    const enrichedData = data.map((sale: any) => {
      const sourceSaleId = String(sale?.sourceSaleId ?? '').trim();
      const sourceReceiptNumber = sourceReceiptMap.get(sourceSaleId);
      const plainSale =
        typeof sale?.toObject === 'function' ? sale.toObject() : { ...sale };

      if (
        plainSale?.transactionType === SaleTransactionType.Refund &&
        sourceReceiptNumber
      ) {
        return {
          ...plainSale,
          refundReceiptNumber: plainSale.receiptNumber,
          receiptNumber: sourceReceiptNumber,
        };
      }

      return plainSale;
    });

    return {
      data: enrichedData as any,
      page,
      limit,
      total,
      hasNext: skip + enrichedData.length < total,
      hasPrev: page > 1,
    };
  }

  async findOne(idOrPosId: string, storeId?: string) {
    const sale = await this.saleModel
      .findOne(this.buildSaleLookup(idOrPosId, storeId))
      .exec();

    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  async update(idOrPosId: string, dto: UpdateSaleDto, storeId?: string) {
    const update: Record<string, unknown> = {
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
      ...(dto.customer !== undefined ? { customer: dto.customer } : {}),
      ...(dto.email !== undefined
        ? { email: this.normalizeEmail(dto.email) }
        : {}),
      ...(dto.discounts !== undefined ? { discounts: dto.discounts } : {}),
      ...(dto.items !== undefined ? { items: dto.items } : {}),
      ...(dto.payment !== undefined ? { payment: dto.payment } : {}),
      ...(dto.totals !== undefined ? { totals: dto.totals } : {}),
    };

    const updated = await this.saleModel
      .findOneAndUpdate(this.buildSaleLookup(idOrPosId, storeId), update, {
        new: true,
      })
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
      const name =
        typeof itemName === 'string' ? itemName.trim().toLowerCase() : '';
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
        itemsSold: { $sum: '$__signedQty' },
        netSales: { $sum: '$__signedNetSales' },
        costOfGoods: { $sum: '$__signedCostOfGoods' },
        grossProfit: { $sum: '$__signedGrossProfit' },
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
                netSales: { $sum: '$__signedNetSales' },
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
        ({
          itemId: row.itemId,
          itemName: row.itemName,
          points: [],
        } as SalesItemSeries);
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
  ): Promise<
    PaginationResult<SalesByCategoryRow> & { from: string; to: string }
  > {
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
        itemsSold: { $sum: '$__signedQty' },
        netSales: { $sum: '$__signedNetSales' },
        costOfGoods: { $sum: '$__signedCostOfGoods' },
        grossProfit: { $sum: '$__signedGrossProfit' },
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
                vars: {
                  t: { $trim: { input: { $ifNull: ['$payment.type', ''] } } },
                },
                in: {
                  $cond: [{ $gt: [{ $strLenCP: '$$t' }, 0] }, '$$t', 'Unknown'],
                },
              },
            },
            __amount: {
              $abs: num({
                $ifNull: [
                  '$totals.amountDue',
                  { $ifNull: ['$totals.amountPaid', 0] },
                ],
              }),
            },
            __isRefund: {
              $eq: ['$transactionType', SaleTransactionType.Refund],
            },
          },
        },
        {
          $group: {
            _id: '$__paymentType',
            paymentTransactions: {
              $sum: { $cond: ['$__isRefund', 0, 1] },
            },
            paymentAmount: {
              $sum: { $cond: ['$__isRefund', 0, '$__amount'] },
            },
            refundTransactions: {
              $sum: { $cond: ['$__isRefund', 1, 0] },
            },
            refundAmount: {
              $sum: { $cond: ['$__isRefund', '$__amount', 0] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            paymentType: '$_id',
            paymentTransactions: 1,
            paymentAmount: 1,
            refundTransactions: 1,
            refundAmount: 1,
            netAmount: { $subtract: ['$paymentAmount', '$refundAmount'] },
          },
        },
        { $sort: { netAmount: -1, paymentAmount: -1 } },
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
              __amount: {
                $abs: num({
                  $ifNull: [
                    '$totals.amountDue',
                    { $ifNull: ['$totals.amountPaid', 0] },
                  ],
                }),
              },
              __isRefund: {
                $eq: ['$transactionType', SaleTransactionType.Refund],
              },
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
              grossSales: {
                $sum: { $cond: ['$__isRefund', 0, '$__amount'] },
              },
              refunds: {
                $sum: { $cond: ['$__isRefund', '$__amount', 0] },
              },
              discounts: {
                $sum: { $cond: ['$__isRefund', 0, '$__discounts'] },
              },
              receipts: {
                $sum: { $cond: ['$__isRefund', 0, 1] },
              },
            },
          },
          {
            $addFields: {
              netSales: {
                $subtract: [
                  { $subtract: ['$grossSales', '$discounts'] },
                  '$refunds',
                ],
              },
              averageSale: {
                $cond: [
                  { $gt: ['$receipts', 0] },
                  {
                    $divide: [
                      {
                        $subtract: [
                          { $subtract: ['$grossSales', '$discounts'] },
                          '$refunds',
                        ],
                      },
                      '$receipts',
                    ],
                  },
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
        customersByActor.map((r: any) => [
          String(r?._id ?? ''),
          Number(r?.count ?? 0),
        ]),
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
    const transactionType = this.parseTransactionTypeFromQuery(query);
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 10,
      maxLimit: 200,
    });

    const filter: any = {
      ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
      ...(transactionType ? { transactionType } : {}),
      createdAt: { $gte: from, $lte: to },
    };
    if (employeeId) filter['cashier.id'] = employeeId;

    const q = String(query?.q ?? '').trim();

    const pipeline: PipelineStage[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'sales',
          let: {
            sourceSaleObjectId: {
              $convert: {
                input: '$sourceSaleId',
                to: 'objectId',
                onError: null,
                onNull: null,
              },
            },
            storeId: '$storeId',
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$_id', '$$sourceSaleObjectId'] },
                    { $eq: ['$storeId', '$$storeId'] },
                  ],
                },
              },
            },
            { $project: { receiptNumber: 1 } },
          ],
          as: '__sourceSale',
        },
      },
      {
        $addFields: {
          __sourceSale: { $first: '$__sourceSale' },
        },
      },
      {
        $addFields: {
          __sourceReceiptNumber: {
            $trim: {
              input: { $ifNull: ['$__sourceSale.receiptNumber', ''] },
            },
          },
          __resolvedReceiptNo: {
            $let: {
              vars: {
                source: {
                  $trim: {
                    input: { $ifNull: ['$__sourceSale.receiptNumber', ''] },
                  },
                },
                fallback: {
                  $trim: {
                    input: {
                      $ifNull: ['$receiptNumber', { $ifNull: ['$posId', ''] }],
                    },
                  },
                },
              },
              in: {
                $cond: [
                  { $eq: ['$transactionType', SaleTransactionType.Refund] },
                  {
                    $cond: [
                      { $gt: [{ $strLenCP: '$$source' }, 0] },
                      '$$source',
                      '$$fallback',
                    ],
                  },
                  '$$fallback',
                ],
              },
            },
          },
        },
      },
    ];

    if (q) {
      pipeline.push({
        $match: {
          $or: [
            { posId: { $regex: q, $options: 'i' } },
            { receiptNumber: { $regex: q, $options: 'i' } },
            { __sourceReceiptNumber: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
            { 'cashier.name': { $regex: q, $options: 'i' } },
            { 'cashier.email': { $regex: q, $options: 'i' } },
            { 'customer.name': { $regex: q, $options: 'i' } },
            { 'customer.email': { $regex: q, $options: 'i' } },
          ],
        },
      });
    }

    const result = await this.saleModel
      .aggregate([
        ...pipeline,
        {
          $facet: {
            data: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  _id: 1,
                  createdAt: 1,
                  currency: 1,
                  transactionType: 1,
                  cashier: 1,
                  customer: 1,
                  email: 1,
                  totals: 1,
                  receiptNo: '$__resolvedReceiptNo',
                },
              },
            ],
            total: [{ $count: 'count' }],
            sales: [
              { $match: { transactionType: SaleTransactionType.Sale } },
              { $count: 'count' },
            ],
            refunds: [
              { $match: { transactionType: SaleTransactionType.Refund } },
              { $count: 'count' },
            ],
          },
        },
      ])
      .exec();

    const facet = result?.[0] ?? {
      data: [],
      total: [],
      sales: [],
      refunds: [],
    };
    const docs = facet.data ?? [];
    const total = Number(facet.total?.[0]?.count ?? 0);
    const salesTotal = Number(facet.sales?.[0]?.count ?? 0);
    const refundsTotal = Number(facet.refunds?.[0]?.count ?? 0);

    const data = docs.map((s: any) => {
      const totalRaw =
        typeof s?.totals?.amountDue === 'number'
          ? s.totals.amountDue
          : typeof s?.totals?.amountPaid === 'number'
            ? s.totals.amountPaid
            : 0;
      const totalNum =
        typeof totalRaw === 'number' ? Math.abs(totalRaw) : Math.abs(0);

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
        receiptNo: String(s?.receiptNo ?? ''),
        date: new Date(s?.createdAt).toISOString(),
        employee: employeeName,
        customer: customerName,
        type:
          s?.transactionType === SaleTransactionType.Refund
            ? ('Refund' as const)
            : ('Sale' as const),
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
      summary: {
        allReceipts: total,
        sales: salesTotal,
        refunds: refundsTotal,
      },
    };
  }

  async reportEndOfDayCash(
    query: any,
    storeId?: string,
  ): Promise<EndOfDayCashReport> {
    const { match, from, to } = this.baseMatchForReports(query, storeId);

    const num = (input: any) => ({
      $convert: { input, to: 'double', onError: 0, onNull: 0 },
    });

    const paymentTypeExpr = {
      $toLower: {
        $trim: { input: { $ifNull: ['$payment.type', ''] } },
      },
    };

    const pipeline: any[] = [
      { $match: match },
      {
        $facet: {
          summary: [
            {
              $addFields: {
                __amount: {
                  $abs: num({
                    $ifNull: [
                      '$totals.amountDue',
                      { $ifNull: ['$totals.amountPaid', 0] },
                    ],
                  }),
                },
                __discounts: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ['$discounts', []] },
                      as: 'discount',
                      in: num({
                        $ifNull: [
                          '$$discount.amount',
                          {
                            $ifNull: [
                              '$$discount.value',
                              {
                                $ifNull: [
                                  '$$discount.discount',
                                  {
                                    $ifNull: [
                                      '$$discount.discountAmount',
                                      0,
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      }),
                    },
                  },
                },
                __changeGiven: { $abs: num('$totals.change') },
                __cashReceived: {
                  $abs: num({
                    $ifNull: [
                      '$payment.cashReceived',
                      { $ifNull: ['$totals.amountPaid', 0] },
                    ],
                  }),
                },
                __paymentType: paymentTypeExpr,
                __isRefund: {
                  $eq: ['$transactionType', SaleTransactionType.Refund],
                },
                __currency: {
                  $trim: { input: { $ifNull: ['$currency', 'PHP'] } },
                },
              },
            },
            {
              $group: {
                _id: null,
                currency: { $first: '$__currency' },
                grossSales: {
                  $sum: { $cond: ['$__isRefund', 0, '$__amount'] },
                },
                refundAmount: {
                  $sum: { $cond: ['$__isRefund', '$__amount', 0] },
                },
                discounts: {
                  $sum: { $cond: ['$__isRefund', 0, '$__discounts'] },
                },
                salesTransactions: {
                  $sum: { $cond: ['$__isRefund', 0, 1] },
                },
                refundTransactions: {
                  $sum: { $cond: ['$__isRefund', 1, 0] },
                },
                cashSales: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$__paymentType', 'cash'] },
                          { $eq: ['$__isRefund', false] },
                        ],
                      },
                      '$__amount',
                      0,
                    ],
                  },
                },
                cashRefunds: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$__paymentType', 'cash'] },
                          { $eq: ['$__isRefund', true] },
                        ],
                      },
                      '$__amount',
                      0,
                    ],
                  },
                },
                cashReceived: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$__paymentType', 'cash'] },
                          { $eq: ['$__isRefund', false] },
                        ],
                      },
                      '$__cashReceived',
                      0,
                    ],
                  },
                },
                changeGiven: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$__paymentType', 'cash'] },
                          { $eq: ['$__isRefund', false] },
                        ],
                      },
                      '$__changeGiven',
                      0,
                    ],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                currency: {
                  $cond: [
                    { $gt: [{ $strLenCP: { $ifNull: ['$currency', ''] } }, 0] },
                    '$currency',
                    'PHP',
                  ],
                },
                grossSales: 1,
                refundAmount: 1,
                discounts: 1,
                salesTransactions: 1,
                refundTransactions: 1,
                receipts: {
                  $add: ['$salesTransactions', '$refundTransactions'],
                },
                netSales: {
                  $subtract: ['$grossSales', '$refundAmount'],
                },
                cashSales: 1,
                cashRefunds: 1,
                cashReceived: 1,
                changeGiven: 1,
                cashCollected: {
                  $subtract: [
                    { $subtract: ['$cashReceived', '$changeGiven'] },
                    '$cashRefunds',
                  ],
                },
                netCash: {
                  $subtract: [
                    { $subtract: ['$cashReceived', '$changeGiven'] },
                    '$cashRefunds',
                  ],
                },
              },
            },
          ],
          costOfGoods: [
            ...this.itemLineStages(),
            {
              $group: {
                _id: null,
                costOfGoods: { $sum: '$__signedCostOfGoods' },
              },
            },
          ],
        },
      },
    ];

    const result = await this.saleModel
      .aggregate(pipeline)
      .exec();

    const facet = result?.[0] ?? { summary: [], costOfGoods: [] };
    const summary = facet.summary?.[0] ?? {};

    const grossSales = Number(summary?.grossSales ?? 0);
    const refundAmount = Number(summary?.refundAmount ?? 0);
    const discounts = Number(summary?.discounts ?? 0);
    const netSales = Number(summary?.netSales ?? 0);
    const costOfGoods = Number(facet.costOfGoods?.[0]?.costOfGoods ?? 0);
    const salesTransactions = Number(summary?.salesTransactions ?? 0);
    const refundTransactions = Number(summary?.refundTransactions ?? 0);
    const receipts = Number(summary?.receipts ?? 0);
    const cashSales = Number(summary?.cashSales ?? 0);
    const cashRefunds = Number(summary?.cashRefunds ?? 0);
    const cashReceived = Number(summary?.cashReceived ?? 0);
    const changeGiven = Number(summary?.changeGiven ?? 0);
    const cashCollected = Number(summary?.cashCollected ?? 0);
    const netCash = Number(summary?.netCash ?? 0);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      currency: String(summary?.currency ?? 'PHP'),
      summary: {
        grossSales,
        netSales,
        discounts,
        refundAmount,
        grossProfit: netSales - costOfGoods,
        costOfGoods,
        salesTransactions,
        refundTransactions,
        receipts,
      },
      cash: {
        sales: cashSales,
        refunds: cashRefunds,
        net: netCash,
        cashReceived,
        changeGiven,
        cashCollected,
      },
    };
  }
}
