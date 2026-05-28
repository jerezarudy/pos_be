import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateItemDto } from './dto/create-item.dto';
import { ItemImagesCloudinaryService } from './item-images-cloudinary.service';
import { TransferItemDto } from './dto/transfer-item.dto';
import { UpdateItemStockDto } from './dto/update-item-stock.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

type UploadedItemImageFile = {
  buffer?: Buffer;
  originalname?: string;
  mimetype?: string;
};

const itemImageUploadInterceptor = FileInterceptor('image', {
  storage: memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      cb(new BadRequestException('Only image uploads are allowed'), false);
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

@Controller('items')
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly itemImagesCloudinaryService: ItemImagesCloudinaryService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('next-sku')
  nextSku() {
    return this.itemsService.generateNextSku();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(itemImageUploadInterceptor)
  async create(@Body() dto: CreateItemDto, @UploadedFile() file?: UploadedItemImageFile) {
    const uploadedImage = file
      ? await this.itemImagesCloudinaryService.uploadItemImage(file)
      : undefined;

    try {
      return await this.itemsService.create({
        ...dto,
        ...(uploadedImage ?? {}),
      });
    } catch (error) {
      await this.itemImagesCloudinaryService.deleteItemImage(
        uploadedImage?.imagePublicId,
      );
      throw error;
    }
  }

  @Get()
  findAll(@Query() query: any) {
    return this.itemsService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('reports/transfers')
  findTransferReports(@Query() query: any) {
    return this.itemsService.findTransferReports(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('transfers')
  findTransfers(@Query() query: any) {
    return this.itemsService.findTransfers(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @UseInterceptors(itemImageUploadInterceptor)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @UploadedFile() file?: UploadedItemImageFile,
  ) {
    return this.updateItemWithImage(id, dto, file);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(itemImageUploadInterceptor)
  async replace(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @UploadedFile() file?: UploadedItemImageFile,
  ) {
    return this.updateItemWithImage(id, dto, file);
  }

  private async updateItemWithImage(
    id: string,
    dto: UpdateItemDto,
    file?: UploadedItemImageFile,
  ) {
    const uploadedImage = file
      ? await this.itemImagesCloudinaryService.uploadItemImage(file)
      : undefined;

    try {
      return await this.itemsService.update(id, {
        ...dto,
        ...(uploadedImage ?? {}),
      });
    } catch (error) {
      await this.itemImagesCloudinaryService.deleteItemImage(
        uploadedImage?.imagePublicId,
      );
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/stock')
  updateStock(@Param('id') id: string, @Body() dto: UpdateItemStockDto) {
    return this.itemsService.updateStock(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/transfer')
  transfer(@Param('id') id: string, @Body() dto: TransferItemDto) {
    return this.itemsService.transfer(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.itemsService.remove(id);
  }
}
