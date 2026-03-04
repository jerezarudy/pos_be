import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type StoreDocument = HydratedDocument<Store>;

@Schema({
  collection: 'stores',
  timestamps: true,
})
export class Store {
  @Prop({ required: true, trim: true })
  ownerId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

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
  phone?: string;

  @Prop({ trim: true })
  description?: string;
}

export const StoreSchema = SchemaFactory.createForClass(Store);
StoreSchema.plugin(createdUpdatedByPlugin);

StoreSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

StoreSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});
