import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, FilterQuery, Model, PipelineStage } from 'mongoose';
import { join } from 'path';
import { PaginationResult, parsePagination } from '../common/pagination';
import { getRequestActor } from '../common/request-context';
import {
  Category,
  CategoryDocument,
} from '../categories/schemas/category.schema';
import { CreateItemDto } from './dto/create-item.dto';
import { ItemImagesCloudinaryService } from './item-images-cloudinary.service';
import { UpdateItemStockDto } from './dto/update-item-stock.dto';
import { TransferItemDto } from './dto/transfer-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { Item, ItemDocument } from './schemas/item.schema';
import {
  ItemTransfer,
  ItemTransferDocument,
} from './schemas/item-transfer.schema';

@Injectable()
export class ItemsService {
  private supportsTransactionsCache: boolean | undefined;

  constructor(
    @InjectModel(Item.name)
    private readonly itemModel: Model<ItemDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(ItemTransfer.name)
    private readonly itemTransferModel: Model<ItemTransferDocument>,
    private readonly itemImagesCloudinaryService: ItemImagesCloudinaryService,
  ) {}

  private async supportsTransactions() {
    if (this.supportsTransactionsCache !== undefined) {
      return this.supportsTransactionsCache;
    }

    try {
      const nativeDb: any = (this.itemModel.db as any)?.db;
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

  private assertNonNegativeNumber(value: unknown, field: string) {
    if (value === undefined) return;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num < 0) {
      throw new BadRequestException(`${field} must be a non-negative number`);
    }
  }

  private parseOptionalSku(sku: unknown) {
    if (sku === undefined || sku === null || sku === '') return undefined;
    const asNumber = typeof sku === 'number' ? sku : Number(String(sku).trim());
    if (!Number.isFinite(asNumber) || asNumber < 0) {
      throw new BadRequestException('sku must be a non-negative number');
    }
    return Math.floor(asNumber);
  }

  private parseOptionalNumber(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') return undefined;
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(num) || num < 0) {
      throw new BadRequestException(`${field} must be a non-negative number`);
    }
    return num;
  }

  private parsePositiveInteger(value: unknown, field: string) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      throw new BadRequestException(`${field} must be a positive number`);
    }
    return Math.floor(num);
  }

  private parseOptionalBoolean(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;

    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }

    throw new BadRequestException('trackStock must be a boolean');
  }

  private normalizeOptionalText(value: unknown) {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text || undefined;
  }

  private normalizeOptionalCategory(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'object') return value as { id?: string; name?: string };

    const raw = String(value).trim();
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as { id?: string; name?: string };
      }
    } catch {
      throw new BadRequestException('category must be a valid JSON object');
    }

    throw new BadRequestException('category must be a valid JSON object');
  }

  private normalizeItemInput<T extends CreateItemDto | UpdateItemDto>(dto: T): T {
    const normalized: any = { ...(dto as any) };

    if (normalized.storeId !== undefined) {
      normalized.storeId = this.normalizeOptionalText(normalized.storeId);
    }
    if (normalized.name !== undefined) {
      normalized.name = this.normalizeOptionalText(normalized.name);
    }
    if (normalized.barcode !== undefined) {
      normalized.barcode = this.normalizeOptionalText(normalized.barcode);
    }
    if (normalized.description !== undefined) {
      normalized.description = this.normalizeOptionalText(normalized.description);
    }
    if (normalized.imageUrl !== undefined) {
      normalized.imageUrl = this.normalizeOptionalText(normalized.imageUrl);
    }
    if (normalized.imagePublicId !== undefined) {
      normalized.imagePublicId = this.normalizeOptionalText(
        normalized.imagePublicId,
      );
    }
    if (normalized.categoryId !== undefined) {
      normalized.categoryId = this.normalizeOptionalText(normalized.categoryId);
    }
    if (normalized.category !== undefined) {
      normalized.category = this.normalizeOptionalCategory(normalized.category);
    }
    if (normalized.sku !== undefined) {
      normalized.sku = this.parseOptionalSku(normalized.sku);
    }
    if (normalized.price !== undefined) {
      normalized.price = this.parseOptionalNumber(normalized.price, 'price');
    }
    if (normalized.cost !== undefined) {
      normalized.cost = this.parseOptionalNumber(normalized.cost, 'cost');
    }
    if (normalized.inStock !== undefined) {
      normalized.inStock = this.parseOptionalNumber(normalized.inStock, 'inStock');
    }
    if (normalized.trackStock !== undefined) {
      normalized.trackStock = this.parseOptionalBoolean(normalized.trackStock);
    }

    return normalized as T;
  }

  private isManagedLocalItemImage(imageUrl?: unknown) {
    const normalized = this.normalizeOptionalText(imageUrl);
    return normalized?.startsWith('/uploads/items/') ?? false;
  }

  private async deleteManagedItemImage(
    imageUrl?: unknown,
    imagePublicId?: unknown,
  ) {
    const normalizedPublicId = this.normalizeOptionalText(imagePublicId);
    if (normalizedPublicId) {
      await this.itemImagesCloudinaryService.deleteItemImage(
        normalizedPublicId,
      );
    }

    const normalizedUrl = this.normalizeOptionalText(imageUrl);
    if (!normalizedUrl || !this.isManagedLocalItemImage(normalizedUrl)) return;

    const relativePath = normalizedUrl.replace(/^\/+/, '').split('/').join('\\');
    const absolutePath = join(process.cwd(), relativePath);

    try {
      await unlink(absolutePath);
    } catch {
      // Ignore missing files so item updates aren't blocked by storage drift.
    }
  }

  private normalizeCategoryId(value: unknown) {
    const raw = typeof value === 'string' ? value : '';
    const id = raw.trim();
    return id || undefined;
  }

  private async resolveCategory(category?: {
    id?: unknown;
    name?: unknown;
  }): Promise<{ id: string; name?: string } | undefined> {
    const id = this.normalizeCategoryId(category?.id);
    if (!id) return undefined;

    const providedName =
      typeof category?.name === 'string' ? category.name.trim() : '';

    if (providedName) {
      return { id, name: providedName };
    }

    const doc = await this.categoryModel
      .findById(id)
      .select({ name: 1 })
      .exec();
    const name = typeof doc?.name === 'string' ? doc.name : undefined;
    return { id, name };
  }

  async generateNextSku() {
    const latest = await this.itemModel
      .findOne({ sku: { $type: 'number' } })
      .sort({ sku: -1, createdAt: -1 })
      .select({ sku: 1 })
      .lean()
      .exec();

    const latestSku = latest?.sku;
    const nextSku =
      typeof latestSku === 'number' && Number.isFinite(latestSku)
        ? latestSku + 1
        : 100000;

    return { sku: nextSku };
  }

  async create(dto: CreateItemDto) {
    dto = this.normalizeItemInput(dto);
    const storeIdNormalized = this.assertStoreId(dto.storeId);
    this.assertNonNegativeNumber(dto.price, 'price');
    this.assertNonNegativeNumber(dto.inStock, 'inStock');
    this.assertNonNegativeNumber(dto.cost, 'cost');

    const trackStock = dto.trackStock ?? false;
    if (!trackStock && dto.inStock !== undefined) {
      throw new BadRequestException(
        'inStock is only allowed when trackStock=true',
      );
    }
    const inStock = trackStock ? (dto.inStock ?? 0) : 0;

    const skuProvided = this.parseOptionalSku(dto.sku);
    const sku = skuProvided ?? (await this.generateNextSku()).sku;

    const categoryId = this.normalizeCategoryId(dto.categoryId);
    const category = await this.resolveCategory(
      dto.category ?? { id: categoryId },
    );

    // Prevent persisting legacy categoryId / raw category input.
    const {
      categoryId: _categoryId,
      category: _category,
      storeId: _storeId,
      ...rest
    } = dto as any;

    const created = await this.itemModel.create({
      ...rest,
      storeId: storeIdNormalized,
      sku,
      trackStock,
      inStock,
      category,
      imageUrl: dto.imageUrl,
      imagePublicId: dto.imagePublicId,
    });
    return created;
  }

  async findAll(query?: any): Promise<PaginationResult<Item>> {
    const { page, limit, skip } = parsePagination(query, { maxLimit: 2000 });

    const storeIdFilter =
      typeof query?.storeId === 'string' ? query.storeId.trim() : '';

    const match: Record<string, unknown> = {
      ...(storeIdFilter ? { storeId: storeIdFilter } : {}),
    };

    const [result] = await this.itemModel
      .aggregate([
        { $match: match },
        {
          $addFields: {
            storeObjectId: {
              $cond: [
                {
                  $regexMatch: {
                    input: '$storeId',
                    regex: /^[a-f\d]{24}$/i,
                  },
                },
                { $toObjectId: '$storeId' },
                null,
              ],
            },
          },
        },
        {
          $lookup: {
            from: 'stores',
            localField: 'storeObjectId',
            foreignField: '_id',
            as: 'storeDoc',
          },
        },
        {
          $unwind: {
            path: '$storeDoc',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            store: {
              id: { $toString: '$storeDoc._id' },
              name: '$storeDoc.name',
            },
          },
        },
        {
          $project: {
            storeDoc: 0,
            storeObjectId: 0,
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
        {
          $addFields: {
            total: {
              $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0],
            },
          },
        },
        { $project: { data: 1, total: 1 } },
      ])
      .exec();

    const data = (result?.data ?? []) as any[];
    const total = Number(result?.total ?? 0);

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
    };
  }

  async findOne(id: string) {
    const item = await this.itemModel.findById(id).exec();
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async update(id: string, dto: UpdateItemDto) {
    dto = this.normalizeItemInput(dto);
    this.assertNonNegativeNumber(dto.price, 'price');
    this.assertNonNegativeNumber(dto.inStock, 'inStock');

    const existing = await this.itemModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Item not found');

    const trackStockAfter = dto.trackStock ?? existing.trackStock;
    if (!trackStockAfter && dto.inStock !== undefined) {
      throw new BadRequestException(
        'inStock is only allowed when trackStock=true',
      );
    }

    const { storeId: storeIdRaw, ...dtoRest } = dto as any;
    const update: Record<string, unknown> = { ...dtoRest };
    delete (update as any).categoryId;

    if (storeIdRaw !== undefined) {
      update.storeId = this.assertStoreId(storeIdRaw);
    }

    if (dto.sku !== undefined) {
      update.sku = dto.sku;
    }

    if (dto.category !== undefined || dto.categoryId !== undefined) {
      const categoryId = this.normalizeCategoryId(dto.categoryId);
      update.category = await this.resolveCategory(
        dto.category ?? { id: categoryId },
      );
      (update as any).$unset = { ...(update as any).$unset, categoryId: 1 };
    }

    if (dto.trackStock === false) {
      update.inStock = 0;
    } else if (dto.inStock !== undefined) {
      update.inStock = dto.inStock;
    } else if (dto.trackStock === true && existing.inStock === undefined) {
      update.inStock = 0;
    }

    if (!trackStockAfter && update.inStock !== undefined) {
      update.inStock = 0;
    }

    if (dto.imageUrl !== undefined) {
      update.imageUrl = dto.imageUrl;

      if (dto.imagePublicId !== undefined) {
        update.imagePublicId = dto.imagePublicId;
      } else {
        (update as any).$unset = {
          ...(update as any).$unset,
          imagePublicId: 1,
        };
      }
    } else if (dto.imagePublicId !== undefined) {
      update.imagePublicId = dto.imagePublicId;
    }

    const updated = await this.itemModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Item not found');

    if (
      (dto.imageUrl !== undefined || dto.imagePublicId !== undefined) &&
      (existing.imageUrl || existing.imagePublicId) &&
      (existing.imageUrl !== updated.imageUrl ||
        existing.imagePublicId !== updated.imagePublicId)
    ) {
      await this.deleteManagedItemImage(
        existing.imageUrl,
        existing.imagePublicId,
      );
    }

    return updated;
  }

  async updateStock(id: string, dto: UpdateItemStockDto) {
    if (dto?.inStock === undefined) {
      throw new BadRequestException('inStock is required');
    }

    this.assertNonNegativeNumber(dto.inStock, 'inStock');
    const inStock =
      typeof dto.inStock === 'number' ? dto.inStock : Number(dto.inStock);

    const existing = await this.itemModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Item not found');

    const updated = await this.itemModel
      .findByIdAndUpdate(
        id,
        {
          trackStock: true,
          inStock,
        },
        { new: true },
      )
      .exec();

    if (!updated) throw new NotFoundException('Item not found');
    return updated;
  }

  async transfer(id: string, dto: TransferItemDto) {
    const transfer = async (session?: ClientSession) => {
      const amount = this.parsePositiveInteger(dto?.amount, 'amount');
      const toStoreId = this.assertStoreId(dto?.toStoreId);

      const sourceQuery = this.itemModel.findById(id);
      if (session) sourceQuery.session(session);
      const source = await sourceQuery.exec();
      if (!source) throw new NotFoundException('Item not found');

      const fromStoreId = this.assertStoreId(source.storeId);
      if (fromStoreId === toStoreId) {
        throw new BadRequestException(
          'toStoreId must be different from the source item storeId',
        );
      }

      if (!source.trackStock) {
        throw new BadRequestException('Source item does not track stock');
      }

      const sourceBeforeStock =
        typeof source.inStock === 'number' ? source.inStock : 0;
      if (sourceBeforeStock < amount) {
        throw new BadRequestException('Insufficient stock for transfer');
      }

      const destinationFilter = this.buildDestinationItemFilter(source, toStoreId);
      const destinationQuery = this.itemModel.findOne(destinationFilter);
      if (session) destinationQuery.session(session);
      const destination = await destinationQuery.exec();

      const sourceAfterStock = sourceBeforeStock - amount;
      const sourceItemDeleted = sourceAfterStock === 0;
      const destinationBeforeStock = destination
        ? typeof destination.inStock === 'number'
          ? destination.inStock
          : 0
        : undefined;

      let destinationItem: ItemDocument;
      let destinationItemCreated = false;

      if (destination) {
        const updatedDestination = await this.itemModel
          .findByIdAndUpdate(
            destination._id,
            {
              trackStock: true,
              $inc: { inStock: amount },
            },
            { new: true, session },
          )
          .exec();
        if (!updatedDestination) {
          throw new NotFoundException('Destination item not found');
        }
        destinationItem = updatedDestination;
      } else {
        const createdDestination = await this.itemModel.create(
          [
            {
              storeId: toStoreId,
              name: source.name,
              category: source.category,
              sku: source.sku,
              barcode: source.barcode,
              price: source.price,
              cost: source.cost,
              description: source.description,
              imageUrl: source.imageUrl,
              trackStock: true,
              inStock: amount,
            },
          ],
          { session },
        );
        destinationItem = createdDestination[0];
        destinationItemCreated = true;
      }

      if (sourceItemDeleted) {
        await this.itemModel.findByIdAndDelete(source._id, { session }).exec();
      } else {
        const updatedSource = await this.itemModel
          .findByIdAndUpdate(
            source._id,
            { inStock: sourceAfterStock },
            { new: true, session },
          )
          .exec();
        if (!updatedSource) throw new NotFoundException('Item not found');
      }

      const destinationAfterStock =
        typeof destinationItem.inStock === 'number'
          ? destinationItem.inStock
          : (destinationBeforeStock ?? 0) + amount;

      const createdTransfer = await this.itemTransferModel.create(
        [
          {
            fromStoreId,
            toStoreId,
            sourceItemId: String(source._id),
            destinationItemId: String(destinationItem._id),
            itemName: source.name,
            sku: source.sku,
            barcode: source.barcode,
            amount,
            sourceBeforeStock,
            sourceAfterStock,
            destinationBeforeStock,
            destinationAfterStock,
            destinationItemCreated,
            sourceItemDeleted,
            transferredBy: getRequestActor(),
          },
        ],
        { session },
      );

      return {
        transfer: createdTransfer[0],
        sourceItem: sourceItemDeleted
          ? null
          : {
              ...source.toObject(),
              inStock: sourceAfterStock,
            },
        destinationItem,
      };
    };

    if (!(await this.supportsTransactions())) {
      return transfer();
    }

    const session: ClientSession = await this.itemModel.db.startSession();
    try {
      let result:
        | {
            transfer: ItemTransferDocument;
            sourceItem: Record<string, unknown> | null;
            destinationItem: ItemDocument;
          }
        | undefined;

      await session.withTransaction(async () => {
        result = await transfer(session);
      });

      if (!result) {
        throw new BadRequestException('Failed to transfer item');
      }

      return result;
    } finally {
      await session.endSession();
    }
  }

  async findTransfers(query?: any): Promise<PaginationResult<ItemTransfer>> {
    return this.findTransferReports(query);
  }

  async findTransferReports(query?: any): Promise<PaginationResult<ItemTransfer>> {
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: 20,
      maxLimit: 200,
    });
    const filters = this.buildTransferReportFilter(query);
    const [result] = await this.itemTransferModel
      .aggregate(this.buildTransferReportPipeline(filters, skip, limit))
      .exec();
    const data = (result?.data ?? []) as ItemTransfer[];
    const total = Number(result?.total?.[0]?.count ?? 0);

    return {
      data,
      page,
      limit,
      total,
      hasNext: skip + data.length < total,
      hasPrev: page > 1,
    };
  }

  private buildTransferReportPipeline(
    filters: FilterQuery<ItemTransferDocument>,
    skip: number,
    limit: number,
  ): PipelineStage[] {
    return [
      { $match: filters },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $addFields: {
                fromStoreObjectId: this.stringObjectIdExpression('$fromStoreId'),
                toStoreObjectId: this.stringObjectIdExpression('$toStoreId'),
                transferredByObjectId:
                  this.stringObjectIdExpression('$transferredBy'),
              },
            },
            {
              $lookup: {
                from: 'stores',
                localField: 'fromStoreObjectId',
                foreignField: '_id',
                as: 'fromStore',
              },
            },
            {
              $lookup: {
                from: 'stores',
                localField: 'toStoreObjectId',
                foreignField: '_id',
                as: 'toStore',
              },
            },
            {
              $lookup: {
                from: 'users',
                localField: 'transferredByObjectId',
                foreignField: '_id',
                as: 'user',
              },
            },
            {
              $addFields: {
                fromStore: { $arrayElemAt: ['$fromStore', 0] },
                toStore: { $arrayElemAt: ['$toStore', 0] },
                user: { $arrayElemAt: ['$user', 0] },
              },
            },
            {
              $project: {
                fromStoreObjectId: 0,
                toStoreObjectId: 0,
                transferredByObjectId: 0,
                'fromStore.__v': 0,
                'toStore.__v': 0,
                'user.passwordHash': 0,
                'user.pos_pin': 0,
                'user.__v': 0,
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];
  }

  private stringObjectIdExpression(input: string) {
    return {
      $cond: [
        {
          $regexMatch: {
            input,
            regex: /^[a-f\d]{24}$/i,
          },
        },
        { $toObjectId: input },
        null,
      ],
    };
  }

  private buildDestinationItemFilter(source: ItemDocument, toStoreId: string) {
    if (typeof source.sku === 'number') {
      return { storeId: toStoreId, sku: source.sku };
    }
    const barcode = this.normalizeOptionalText(source.barcode);
    if (barcode) {
      return { storeId: toStoreId, barcode };
    }
    return { storeId: toStoreId, name: source.name };
  }

  private buildTransferReportFilter(query?: any): FilterQuery<ItemTransferDocument> {
    const filters: FilterQuery<ItemTransferDocument>[] = [];

    const fromStoreId = this.firstTrimmedString(
      query?.fromStoreId,
      query?.originStoreId,
      query?.storeOrigin,
    );
    if (fromStoreId) filters.push({ fromStoreId });

    const toStoreId = this.firstTrimmedString(
      query?.toStoreId,
      query?.destinationStoreId,
      query?.storeDestination,
    );
    if (toStoreId) filters.push({ toStoreId });

    const itemId =
      typeof query?.itemId === 'string' ? query.itemId.trim() : '';
    if (itemId) {
      filters.push({
        $or: [{ sourceItemId: itemId }, { destinationItemId: itemId }],
      });
    }

    const from = this.parseDate(query?.from ?? query?.startDate);
    const to = this.parseDate(query?.to ?? query?.endDate, true);
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.$gte = from;
      if (to) createdAt.$lte = to;
      filters.push({ createdAt });
    }

    return filters.length === 0
      ? {}
      : filters.length === 1
        ? filters[0]
        : { $and: filters };
  }

  private firstTrimmedString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return '';
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
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  async remove(id: string) {
    const deleted = await this.itemModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Item not found');
    await this.deleteManagedItemImage(deleted.imageUrl, deleted.imagePublicId);
    return { deleted: true, id };
  }

  private parseSaleLine(line: any): { itemId: string; qty: number } {
    const rawItemId =
      line?.itemId ??
      line?.id ??
      line?._id ??
      line?.itemId?._id ??
      line?.item?.id ??
      line?.item?._id;

    const itemId = rawItemId !== undefined ? String(rawItemId).trim() : '';
    if (!itemId) throw new BadRequestException('Sale item is missing itemId');

    const rawQty = line?.qty ?? line?.quantity ?? line?.count;
    const qtyNum = typeof rawQty === 'number' ? rawQty : Number(rawQty);
    const qty =
      Number.isFinite(qtyNum) && qtyNum > 0 ? Math.floor(qtyNum) : NaN;
    if (!Number.isFinite(qty)) {
      throw new BadRequestException(`Invalid qty for sale item ${itemId}`);
    }

    return { itemId, qty };
  }

  async decrementStockForSale(
    saleItems: any[],
    storeId?: string,
    opts?: { session?: ClientSession; allowCrossStore?: boolean },
  ) {
    const allowCrossStore = opts?.allowCrossStore ?? true;
    const storeIdNormalized = allowCrossStore
      ? undefined
      : this.assertStoreId(storeId);
    const items = Array.isArray(saleItems) ? saleItems : [];
    const session = opts?.session;

    for (const line of items) {
      const { itemId, qty } = this.parseSaleLine(line);

      const updated = await this.itemModel
        .findOneAndUpdate(
          {
            _id: itemId,
            ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
            trackStock: true,
            inStock: { $gte: qty },
          },
          { $inc: { inStock: -qty } },
          { new: true, session },
        )
        .exec();

      if (updated) continue;

      const existingQuery = this.itemModel
        .findOne({
          _id: itemId,
          ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
        })
        .select({ trackStock: 1, inStock: 1 });
      if (session) existingQuery.session(session);
      const existingDoc = await existingQuery.exec();

      if (!existingDoc) throw new NotFoundException('Item not found');
      if (!existingDoc.trackStock) continue;

      const currentStock =
        typeof existingDoc.inStock === 'number' ? existingDoc.inStock : 0;
      if (currentStock < qty) {
        throw new BadRequestException('Insufficient stock for item');
      }
    }
  }

  async incrementStockForSale(
    saleItems: any[],
    storeId?: string,
    opts?: { session?: ClientSession; allowCrossStore?: boolean },
  ) {
    const allowCrossStore = opts?.allowCrossStore ?? true;
    const storeIdNormalized = allowCrossStore
      ? undefined
      : this.assertStoreId(storeId);
    const items = Array.isArray(saleItems) ? saleItems : [];
    const session = opts?.session;

    for (const line of items) {
      const { itemId, qty } = this.parseSaleLine(line);

      const existingQuery = this.itemModel
        .findOne({
          _id: itemId,
          ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
        })
        .select({ trackStock: 1 });
      if (session) existingQuery.session(session);
      const existingDoc = await existingQuery.exec();

      if (!existingDoc) throw new NotFoundException('Item not found');
      if (!existingDoc.trackStock) continue;

      await this.itemModel
        .findOneAndUpdate(
          {
            _id: itemId,
            ...(storeIdNormalized ? { storeId: storeIdNormalized } : {}),
            trackStock: true,
          },
          { $inc: { inStock: qty } },
          { new: true, session },
        )
        .exec();
    }
  }
}
