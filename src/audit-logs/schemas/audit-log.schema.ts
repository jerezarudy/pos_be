import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  collection: 'audit_logs',
  timestamps: true,
})
export class AuditLog {
  @Prop({ required: true })
  timestamp!: Date;

  @Prop({ required: true, trim: true })
  method!: string;

  @Prop({ required: true, trim: true })
  path!: string;

  @Prop()
  statusCode?: number;

  @Prop({ min: 0 })
  durationMs?: number;

  @Prop({ trim: true })
  ip?: string;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ trim: true })
  userId?: string;

  @Prop({ trim: true })
  userRole?: string;

  @Prop({ type: Object })
  params?: Record<string, unknown>;

  @Prop({ type: Object })
  query?: Record<string, unknown>;

  @Prop({ type: Object })
  body?: unknown;

  @Prop({ trim: true })
  errorMessage?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

AuditLogSchema.set('toObject', {
  transform: (_doc: any, ret: any) => {
    delete ret.__v;
    return ret;
  },
});
