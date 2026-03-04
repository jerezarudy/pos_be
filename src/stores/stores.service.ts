import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationResult, parsePagination } from '../common/pagination';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { Store, StoreDocument } from './schemas/store.schema';

@Injectable()
export class StoresService {
  constructor(
    @InjectModel(Store.name)
    private readonly storeModel: Model<StoreDocument>,
  ) {}

  async create(dto: CreateStoreDto) {
    return this.storeModel.create(dto);
  }

  async findAll(query?: any): Promise<PaginationResult<Store>> {
    const { page, limit, skip } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.storeModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.storeModel.countDocuments().exec(),
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
    const store = await this.storeModel.findById(id).exec();
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async update(id: string, dto: UpdateStoreDto) {
    const updated = await this.storeModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Store not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.storeModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Store not found');
    return { deleted: true, id };
  }
}
