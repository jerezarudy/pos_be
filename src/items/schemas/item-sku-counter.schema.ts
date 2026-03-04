import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type ItemSkuCounterDocument = HydratedDocument<ItemSkuCounter>;

@Schema({
  collection: 'item_sku_counters',
  timestamps: true,
})
export class ItemSkuCounter {
  @Prop({ required: true, trim: true, unique: true, index: true })
  storeId!: string;

  @Prop({ required: true, min: 0 })
  seq!: number;
}

export const ItemSkuCounterSchema = SchemaFactory.createForClass(ItemSkuCounter);
ItemSkuCounterSchema.plugin(createdUpdatedByPlugin);

ItemSkuCounterSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

ItemSkuCounterSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});
