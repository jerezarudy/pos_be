import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemStockDto } from './dto/update-item-stock.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

const itemImagesDir = join(process.cwd(), 'uploads', 'items');

function ensureItemImagesDir() {
  if (!existsSync(itemImagesDir)) {
    mkdirSync(itemImagesDir, { recursive: true });
  }
}

function normalizeImageExtension(file: {
  originalname?: string;
  mimetype?: string;
}) {
  const originalExtension = extname(file.originalname ?? '').toLowerCase();
  if (originalExtension) return originalExtension;

  switch (file.mimetype) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '';
  }
}

function buildItemImageUrl(file?: { filename?: string }) {
  const filename =
    typeof file?.filename === 'string' ? file.filename.trim() : '';
  return filename ? `/uploads/items/${filename}` : undefined;
}

const itemImageUploadInterceptor = FileInterceptor('image', {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      ensureItemImagesDir();
      cb(null, itemImagesDir);
    },
    filename: (_req, file, cb) => {
      const extension = normalizeImageExtension(file);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${uniqueSuffix}${extension}`);
    },
  }),
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
  constructor(private readonly itemsService: ItemsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('next-sku')
  nextSku() {
    return this.itemsService.generateNextSku();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(itemImageUploadInterceptor)
  create(@Body() dto: CreateItemDto, @UploadedFile() file?: { filename?: string }) {
    return this.itemsService.create({
      ...dto,
      ...(buildItemImageUrl(file) ? { imageUrl: buildItemImageUrl(file) } : {}),
    });
  }

  @Get()
  findAll(@Query() query: any) {
    return this.itemsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @UseInterceptors(itemImageUploadInterceptor)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @UploadedFile() file?: { filename?: string },
  ) {
    return this.itemsService.update(id, {
      ...dto,
      ...(buildItemImageUrl(file) ? { imageUrl: buildItemImageUrl(file) } : {}),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/stock')
  updateStock(@Param('id') id: string, @Body() dto: UpdateItemStockDto) {
    return this.itemsService.updateStock(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.itemsService.remove(id);
  }
}
