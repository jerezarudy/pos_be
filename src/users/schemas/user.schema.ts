import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '../user-role.enum';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: true,
})
export class User {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, unique: true })
  email!: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.Employee,
  })
  role!: UserRole;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ trim: true })
  storeId?: string;

  @Prop({ trim: true })
  assignedStoreId?: string;

  @Prop({ select: true })
  pos_pin?: string;

  @Prop({ select: false })
  passwordHash?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.plugin(createdUpdatedByPlugin);

UserSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    if (ret.role === 'store_owner') ret.role = 'owner';
    if (ret.storeId === undefined && ret.assignedStoreId !== undefined) {
      ret.storeId = ret.assignedStoreId;
    }
    delete ret.assignedStoreId;
    // delete ret.pos_pin;
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

UserSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    if (ret.role === 'store_owner') ret.role = 'owner';
    if (ret.storeId === undefined && ret.assignedStoreId !== undefined) {
      ret.storeId = ret.assignedStoreId;
    }
    delete ret.assignedStoreId;
    // delete ret.pos_pin;
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});
