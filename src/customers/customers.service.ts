import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { PaginationResult, parsePagination } from '../common/pagination';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer, CustomerDocument } from './schemas/customer.schema';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
  ) {}

  private assertStoreId(storeId?: string) {
    const normalized = storeId?.trim();
    if (!normalized) {
      throw new BadRequestException('User has no assigned storeId');
    }
    return normalized;
  }

  async create(dto: CreateCustomerDto, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
    return this.customerModel.create({
      storeId: storeIdNormalized,
      name: dto.name?.trim(),
      email: dto.email?.trim()?.toLowerCase() || undefined,
      phone: dto.phone?.trim() || undefined,
      address: dto.address?.trim() || undefined,
      city: dto.city?.trim() || undefined,
      province: dto.province?.trim() || undefined,
      postalCode: dto.postalCode?.trim() || undefined,
      country: dto.country?.trim() || undefined,
      notes: dto.notes,
      isActive: dto.isActive ?? true,
    });
  }

  async findAll(
    query: any,
    storeId?: string,
  ): Promise<PaginationResult<Customer>> {
    const storeIdNormalized = this.assertStoreId(storeId);
    const { page, limit, skip } = parsePagination(query);

    const q = String(query?.q ?? '').trim();
    const filter: any = { storeId: storeIdNormalized };
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.customerModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.customerModel.countDocuments(filter).exec(),
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

  async findOne(id: string, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
    const customer = await this.customerModel
      .findOne({ _id: id, storeId: storeIdNormalized })
      .exec();
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);

    const existing = await this.customerModel
      .findOne({ _id: id, storeId: storeIdNormalized })
      .exec();
    if (!existing) throw new NotFoundException('Customer not found');

    const updated = await this.customerModel
      .findOneAndUpdate(
        { _id: id, storeId: storeIdNormalized },
        {
          ...(dto.name !== undefined ? { name: dto.name?.trim() } : {}),
          ...(dto.email !== undefined
            ? { email: dto.email?.trim()?.toLowerCase() || undefined }
            : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() } : {}),
          ...(dto.address !== undefined ? { address: dto.address?.trim() } : {}),
          ...(dto.city !== undefined ? { city: dto.city?.trim() } : {}),
          ...(dto.province !== undefined
            ? { province: dto.province?.trim() }
            : {}),
          ...(dto.postalCode !== undefined
            ? { postalCode: dto.postalCode?.trim() }
            : {}),
          ...(dto.country !== undefined ? { country: dto.country?.trim() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        { new: true },
      )
      .exec();

    if (!updated) throw new NotFoundException('Customer not found');
    return updated;
  }

  async remove(id: string, storeId?: string) {
    const storeIdNormalized = this.assertStoreId(storeId);
    const deleted = await this.customerModel
      .findOneAndDelete({ _id: id, storeId: storeIdNormalized })
      .exec();
    if (!deleted) throw new NotFoundException('Customer not found');
    return { deleted: true, id };
  }
}

