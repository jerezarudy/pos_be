import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { createdUpdatedByPlugin } from '../../common/mongoose-audit.plugin';

export type SaleDocument = HydratedDocument<Sale>;

const Mixed = MongooseSchema.Types.Mixed;

export enum SaleTransactionType {
  Sale = 'sale',
  Refund = 'refund',
}

@Schema({ _id: false })
export class SalePayment {
  @Prop({ trim: true })
  type?: string;

  @Prop({ min: 0 })
  cashReceived?: number;
}

export const SalePaymentSchema = SchemaFactory.createForClass(SalePayment);

@Schema({ _id: false })
export class SaleTotals {
  @Prop({ min: 0 })
  amountDue?: number;

  @Prop({ min: 0 })
  amountPaid?: number;

  @Prop()
  change?: number;
}

export const SaleTotalsSchema = SchemaFactory.createForClass(SaleTotals);

@Schema({ _id: false })
export class SaleCashier {
  @Prop({ required: true, trim: true })
  id!: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;
}

export const SaleCashierSchema = SchemaFactory.createForClass(SaleCashier);

@Schema({
  collection: 'sales',
  timestamps: true,
})
export class Sale {
  @Prop({ required: true, trim: true, index: true })
  storeId!: string;

  @Prop({
    required: true,
    trim: true,
    enum: Object.values(SaleTransactionType),
    default: SaleTransactionType.Sale,
    index: true,
  })
  transactionType!: SaleTransactionType;

  // Client-generated sale id (UUID) from POS app.
  @Prop({ required: true, trim: true, index: true })
  posId!: string;

  // Server-generated receipt number, format: YYYYMMDD000001
  @Prop({ trim: true, index: true })
  receiptNumber?: string;

  @Prop({ trim: true, default: 'PHP' })
  currency!: string;

  @Prop({ trim: true, index: true })
  customerId?: string;

  @Prop({ trim: true })
  sourceSaleId?: string;

  @Prop({ trim: true, index: true })
  refundSaleId?: string;

  @Prop()
  refundedAt?: Date;

  @Prop({ trim: true })
  refundReason?: string;

  // Optional email address for receipts / customer contact.
  @Prop({ trim: true, lowercase: true, index: true })
  email?: string;

  @Prop({ type: Mixed })
  customer?: any;

  @Prop({ type: [Mixed], default: [] })
  discounts!: any[];

  @Prop({ type: [Mixed], default: [] })
  items!: any[];

  @Prop({ type: SalePaymentSchema })
  payment?: SalePayment;

  @Prop({ type: SaleTotalsSchema })
  totals?: SaleTotals;

  @Prop({ type: SaleCashierSchema, required: true })
  cashier!: SaleCashier;
}

export const SaleSchema = SchemaFactory.createForClass(Sale);
SaleSchema.plugin(createdUpdatedByPlugin);

SaleSchema.index({ storeId: 1, createdAt: -1 });
SaleSchema.index({ storeId: 1, transactionType: 1, createdAt: -1 });
SaleSchema.index({ storeId: 1, posId: 1 }, { unique: true });
SaleSchema.index(
  { storeId: 1, receiptNumber: 1 },
  { unique: true, sparse: true },
);
SaleSchema.index({ sourceSaleId: 1 }, { unique: true, sparse: true });

SaleSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

SaleSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});
