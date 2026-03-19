import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { join } from 'path';
import { PaginationResult, parsePagination } from '../common/pagination';
import {
  Category,
  CategoryDocument,
} from '../categories/schemas/category.schema';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemStockDto } from './dto/update-item-stock.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { Item, ItemDocument } from './schemas/item.schema';

@Injectable()
export class ItemsService {
  constructor(
    @InjectModel(Item.name)
    private readonly itemModel: Model<ItemDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

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

  private isManagedItemImage(imageUrl?: unknown) {
    const normalized = this.normalizeOptionalText(imageUrl);
    return normalized?.startsWith('/uploads/items/') ?? false;
  }

  private async deleteManagedItemImage(imageUrl?: unknown) {
    const normalized = this.normalizeOptionalText(imageUrl);
    if (!normalized || !this.isManagedItemImage(normalized)) return;

    const relativePath = normalized.replace(/^\/+/, '').split('/').join('\\');
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
    }

    const updated = await this.itemModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Item not found');

    if (
      dto.imageUrl !== undefined &&
      existing.imageUrl &&
      existing.imageUrl !== updated.imageUrl
    ) {
      await this.deleteManagedItemImage(existing.imageUrl);
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

  async remove(id: string) {
    const deleted = await this.itemModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Item not found');
    await this.deleteManagedItemImage(deleted.imageUrl);
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
