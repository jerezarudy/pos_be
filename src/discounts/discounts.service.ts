import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DiscountType } from './discount-type.enum';
import { PaginationResult, parsePagination } from '../common/pagination';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { Discount, DiscountDocument } from './schemas/discount.schema';

@Injectable()
export class DiscountsService {
  constructor(
    @InjectModel(Discount.name)
    private readonly discountModel: Model<DiscountDocument>,
  ) {}

  private assertValid(type: DiscountType, value?: number) {
    if (!Object.values(DiscountType).includes(type)) {
      throw new BadRequestException('Invalid discount type');
    }
    if (value === undefined || value === null) return;
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('value must be a non-negative number');
    }
    if (type === DiscountType.Percentage && value > 100) {
      throw new BadRequestException('percentage value cannot exceed 100');
    }
  }

  async create(dto: CreateDiscountDto) {
    this.assertValid(dto.type, dto.value);
    try {
      return await this.discountModel.create({
        name: dto.name?.trim(),
        type: dto.type,
        value: dto.value,
        restrictedAccess: dto.restrictedAccess ?? false,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('Discount name already exists');
      }
      throw err;
    }
  }

  async findAll(query?: any): Promise<PaginationResult<Discount>> {
    const { page, limit, skip } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.discountModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.discountModel.countDocuments().exec(),
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
    const discount = await this.discountModel.findById(id).exec();
    if (!discount) throw new NotFoundException('Discount not found');
    return discount;
  }

  async update(id: string, dto: UpdateDiscountDto) {
    const existing = await this.discountModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Discount not found');

    const typeAfter = dto.type ?? existing.type;
    const valueAfter =
      dto.value !== undefined ? dto.value : (existing.value as number | undefined);
    this.assertValid(typeAfter, valueAfter);

    try {
      const updated = await this.discountModel
        .findByIdAndUpdate(
          id,
          {
            ...(dto.name !== undefined ? { name: dto.name?.trim() } : {}),
            ...(dto.type !== undefined ? { type: dto.type } : {}),
            ...(dto.value !== undefined ? { value: dto.value } : {}),
            ...(dto.restrictedAccess !== undefined
              ? { restrictedAccess: dto.restrictedAccess }
              : {}),
          },
          { new: true },
        )
        .exec();
      if (!updated) throw new NotFoundException('Discount not found');
      return updated;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('Discount name already exists');
      }
      throw err;
    }
  }

  async remove(id: string) {
    const deleted = await this.discountModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Discount not found');
    return { deleted: true, id };
  }
}
