import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { PaginationResult, parsePagination } from '../common/pagination';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import { CreateItemDto } from './dto/create-item.dto';
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
      throw new BadRequestException('User has no assigned storeId');
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

    const doc = await this.categoryModel.findById(id).select({ name: 1 }).exec();
    const name = typeof doc?.name === 'string' ? doc.name : undefined;
    return { id, name };
  }

  async generateNextSku(storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);

    const latest = await this.itemModel
      .findOne({ storeId: storeIdNormalized, sku: { $type: 'number' } })
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

  async create(dto: CreateItemDto, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
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
    const sku =
      skuProvided ?? (await this.generateNextSku(storeIdNormalized)).sku;

    const categoryId = this.normalizeCategoryId(dto.categoryId);
    const category = await this.resolveCategory(dto.category ?? { id: categoryId });

    // Prevent persisting legacy categoryId / raw category input.
    const { categoryId: _categoryId, category: _category, ...rest } = dto as any;

    const created = await this.itemModel.create({
      ...rest,
      storeId: storeIdNormalized,
      sku,
      trackStock,
      inStock,
      category,
    });
    return created;
  }

  async findAll(query?: any): Promise<PaginationResult<Item>> {
    const { page, limit, skip } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.itemModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.itemModel.countDocuments().exec(),
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

  async findOne(id: string) {
    const item = await this.itemModel.findById(id).exec();
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async update(id: string, dto: UpdateItemDto, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
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

    const update: Record<string, unknown> = { ...dto, storeId: storeIdNormalized };
    delete (update as any).categoryId;

    if (dto.sku !== undefined) {
      update.sku = this.parseOptionalSku(dto.sku);
    }

    if (dto.category !== undefined || dto.categoryId !== undefined) {
      const categoryId = this.normalizeCategoryId(dto.categoryId);
      update.category = await this.resolveCategory(dto.category ?? { id: categoryId });
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

    const updated = await this.itemModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Item not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.itemModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Item not found');
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
}
