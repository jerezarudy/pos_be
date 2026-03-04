import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DiscountType } from '../discount-type.enum';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type DiscountDocument = HydratedDocument<Discount>;

@Schema({
  collection: 'discounts',
  timestamps: true,
})
export class Discount {
  @Prop({ required: true, trim: true, unique: true })
  name!: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(DiscountType),
  })
  type!: DiscountType;

  @Prop({ min: 0 })
  value?: number;

  @Prop({ default: false })
  restrictedAccess!: boolean;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);
DiscountSchema.plugin(createdUpdatedByPlugin);

DiscountSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

DiscountSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});
