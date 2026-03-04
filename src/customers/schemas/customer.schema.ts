import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({
  collection: 'customers',
  timestamps: true,
})
export class Customer {
  @Prop({ required: true, trim: true, index: true })
  storeId!: string;

  @Prop({ required: true, trim: true, index: true })
  name!: string;

  @Prop({ trim: true, lowercase: true, index: true })
  email?: string;

  @Prop({ trim: true, index: true })
  phone?: string;

  @Prop({ trim: true })
  address?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  province?: string;

  @Prop({ trim: true })
  postalCode?: string;

  @Prop({ trim: true, default: 'Philippines' })
  country!: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.plugin(createdUpdatedByPlugin);

CustomerSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

CustomerSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

