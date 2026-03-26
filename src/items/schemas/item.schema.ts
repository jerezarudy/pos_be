import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type ItemDocument = HydratedDocument<Item>;

@Schema({ _id: false })
export class ItemCategory {
  @Prop({ trim: true })
  id?: string;

  @Prop({ trim: true })
  name?: string;
}

export const ItemCategorySchema = SchemaFactory.createForClass(ItemCategory);

@Schema({
  collection: 'items',
  timestamps: true,
})
export class Item {
  @Prop({ required: true, trim: true, index: true })
  storeId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: ItemCategorySchema })
  category?: ItemCategory;

  @Prop({ min: 0 })
  sku?: number;

  @Prop()
  barcode?: string;

  @Prop({ min: 0 })
  price?: number;

  @Prop({ min: 0 })
  cost?: number;

  @Prop()
  description?: string;

  @Prop({ trim: true })
  imageUrl?: string;

  @Prop({ trim: true })
  imagePublicId?: string;

  @Prop({ default: false })
  trackStock!: boolean;

  @Prop({ min: 0, default: 0 })
  inStock!: number;
}

export const ItemSchema = SchemaFactory.createForClass(Item);
ItemSchema.plugin(createdUpdatedByPlugin);
