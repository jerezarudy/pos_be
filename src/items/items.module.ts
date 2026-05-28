import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemsController } from './items.controller';
import { ItemImagesCloudinaryService } from './item-images-cloudinary.service';
import { ItemsService } from './items.service';
import { Item, ItemSchema } from './schemas/item.schema';
import {
  ItemTransfer,
  ItemTransferSchema,
} from './schemas/item-transfer.schema';
import { Category, CategorySchema } from '../categories/schemas/category.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Item.name, schema: ItemSchema }]),
    MongooseModule.forFeature([{ name: Category.name, schema: CategorySchema }]),
    MongooseModule.forFeature([
      { name: ItemTransfer.name, schema: ItemTransferSchema },
    ]),
  ],
  controllers: [ItemsController],
  providers: [ItemsService, ItemImagesCloudinaryService],
  exports: [ItemsService],
})
export class ItemsModule {}
