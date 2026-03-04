import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationResult, parsePagination } from '../common/pagination';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category, CategoryDocument } from './schemas/category.schema';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  async create(dto: CreateCategoryDto) {
    try {
      return await this.categoryModel.create({
        name: dto.name?.trim(),
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('Category name already exists');
      }
      throw err;
    }
  }

  async findAll(query?: any): Promise<PaginationResult<Category>> {
    const { page, limit, skip } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.categoryModel.find().sort({ name: 1 }).skip(skip).limit(limit).exec(),
      this.categoryModel.countDocuments().exec(),
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
    const category = await this.categoryModel.findById(id).exec();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    try {
      const updated = await this.categoryModel
        .findByIdAndUpdate(
          id,
          { ...(dto.name !== undefined ? { name: dto.name?.trim() } : {}) },
          { new: true },
        )
        .exec();
      if (!updated) throw new NotFoundException('Category not found');
      return updated;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('Category name already exists');
      }
      throw err;
    }
  }

  async remove(id: string) {
    const deleted = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Category not found');
    return { deleted: true, id };
  }
}
