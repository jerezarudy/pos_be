import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ItemTransferDocument = HydratedDocument<ItemTransfer>;

@Schema({
  collection: 'item_transfers',
  timestamps: true,
})
export class ItemTransfer {
  @Prop({ required: true, trim: true })
  fromStoreId!: string;

  @Prop({ required: true, trim: true })
  toStoreId!: string;

  @Prop({ required: true, trim: true })
  sourceItemId!: string;

  @Prop({ trim: true })
  destinationItemId?: string;

  @Prop({ required: true, trim: true })
  itemName!: string;

  @Prop({ min: 0 })
  sku?: number;

  @Prop({ trim: true })
  barcode?: string;

  @Prop({ required: true, min: 1 })
  amount!: number;

  @Prop({ required: true, min: 0 })
  sourceBeforeStock!: number;

  @Prop({ required: true, min: 0 })
  sourceAfterStock!: number;

  @Prop({ min: 0 })
  destinationBeforeStock?: number;

  @Prop({ required: true, min: 0 })
  destinationAfterStock!: number;

  @Prop({ required: true })
  destinationItemCreated!: boolean;

  @Prop({ required: true })
  sourceItemDeleted!: boolean;

  @Prop({ trim: true })
  transferredBy?: string;
}

export const ItemTransferSchema = SchemaFactory.createForClass(ItemTransfer);

ItemTransferSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

ItemTransferSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});
