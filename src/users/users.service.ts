import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { PaginationResult, parsePagination } from '../common/pagination';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from './user-role.enum';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private async hashPassword(password: string) {
    const roundsRaw = process.env.BCRYPT_SALT_ROUNDS;
    const rounds = roundsRaw ? Number(roundsRaw) : 10;
    const saltRounds = Number.isFinite(rounds) && rounds >= 4 ? rounds : 10;
    return bcrypt.hash(password, saltRounds);
  }

  private assertValidPosPin(posPin: string) {
    if (!/^\d{6}$/.test(posPin)) {
      throw new BadRequestException('pos_pin must be a 6-digit string');
    }
  }

  async create(dto: CreateUserDto) {
    const name = dto.name?.trim() || dto.email;
    const role = dto.role ?? UserRole.Employee;
    const passwordHash = await this.hashPassword(dto.password);
    const storeIdRaw = dto.storeId ?? dto.assignedStoreId;
    const storeId = storeIdRaw?.trim() || undefined;

    if (role === UserRole.Cashier) {
      if (!dto.pos_pin) {
        throw new BadRequestException('pos_pin is required for cashier users');
      }
      this.assertValidPosPin(dto.pos_pin);
    } else if (dto.pos_pin) {
      throw new BadRequestException(
        'pos_pin can only be set for cashier users',
      );
    }

    try {
      return await this.userModel.create({
        name,
        email: dto.email,
        role,
        isActive: dto.isActive ?? true,
        storeId,
        pos_pin: role === UserRole.Cashier ? dto.pos_pin : undefined,
        passwordHash,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('Email already exists');
      }
      throw err;
    }
  }

  async findAll(query?: any): Promise<PaginationResult<User>> {
    const { page, limit, skip } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.userModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments().exec(),
    ]);

    console.log('data:', data);
    console.log('total:', total);
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
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.userModel
      .findById(id)
      .select('+pos_pin')
      .exec();
    if (!existing) throw new NotFoundException('User not found');

    const roleAfter = dto.role ?? existing.role;

    if (dto.pos_pin) this.assertValidPosPin(dto.pos_pin);

    if (roleAfter === UserRole.Cashier) {
      const hasPinAlready = Boolean(existing.pos_pin);
      const hasPinProvided = Boolean(dto.pos_pin);
      if (!hasPinAlready && !hasPinProvided) {
        throw new BadRequestException(
          'pos_pin is required when setting role to cashier',
        );
      }
    } else if (dto.pos_pin) {
      throw new BadRequestException(
        'pos_pin can only be set for cashier users',
      );
    }

    const update: Record<string, unknown> = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.storeId !== undefined || dto.assignedStoreId !== undefined
        ? {
            storeId: (dto.storeId ?? dto.assignedStoreId)?.trim() || undefined,
          }
        : {}),
    };

    if (dto.password)
      update.passwordHash = await this.hashPassword(dto.password);

    if (roleAfter === UserRole.Cashier) {
      if (dto.pos_pin) update.pos_pin = dto.pos_pin;
    } else {
      update.pos_pin = undefined;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.userModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('User not found');
    return { deleted: true, id };
  }

  async findByEmailForLogin(email: string) {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  async listSalesEmployees(opts?: { storeId?: string; userId?: string }) {
    const storeId = opts?.storeId?.trim() || undefined;
    const userId = opts?.userId?.trim() || undefined;

    const roles = [UserRole.Owner, UserRole.Employee, UserRole.Cashier];

    return this.userModel
      .find({
        ...(storeId ? { storeId } : {}),
        ...(userId ? { _id: userId } : {}),
        isActive: true,
        role: { $in: roles },
      })
      .select({ name: 1, email: 1, role: 1, storeId: 1 })
      .sort({ name: 1, createdAt: 1 })
      .exec();
  }
}
