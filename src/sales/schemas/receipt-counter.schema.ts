import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReceiptCounterDocument = HydratedDocument<ReceiptCounter>;

@Schema({
  collection: 'receipt_counters',
  timestamps: true,
})
export class ReceiptCounter {
  @Prop({ required: true, trim: true, index: true })
  storeId!: string;

  // Local-day key used for receipt numbering, format: YYYYMMDD
  @Prop({ required: true, trim: true, index: true })
  dayKey!: string;

  @Prop({ required: true, min: 0, default: 0 })
  seq!: number;
}

export const ReceiptCounterSchema = SchemaFactory.createForClass(ReceiptCounter);
ReceiptCounterSchema.index({ storeId: 1, dayKey: 1 }, { unique: true });

ReceiptCounterSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

ReceiptCounterSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

