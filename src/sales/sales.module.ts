import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemsModule } from '../items/items.module';
import { UsersModule } from '../users/users.module';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import {
  ReceiptCounter,
  ReceiptCounterSchema,
} from './schemas/receipt-counter.schema';
import { Sale, SaleSchema } from './schemas/sale.schema';

@Module({
  imports: [
    UsersModule,
    ItemsModule,
    MongooseModule.forFeature([{ name: Sale.name, schema: SaleSchema }]),
    MongooseModule.forFeature([{ name: Customer.name, schema: CustomerSchema }]),
    MongooseModule.forFeature([
      { name: ReceiptCounter.name, schema: ReceiptCounterSchema },
    ]),
  ],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
