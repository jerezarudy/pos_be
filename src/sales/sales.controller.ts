import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { SalesService } from './sales.service';

function normalizeStoreIdQuery(query: any) {
  const raw = typeof query?.storeId === 'string' ? query.storeId : '';
  const storeId = raw.trim();
  return storeId || undefined;
}

@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateSaleDto) {
    return this.salesService.create(dto, req?.user);
  }

  @Get()
  findAll(@Req() req: any, @Query() query: any) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.findAll(query, storeId);
  }

  @Get('reports/by-item')
  reportByItem(@Req() req: any, @Query() query: any) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.reportByItem(query, storeId);
  }

  @Get('reports/by-category')
  reportByCategory(@Req() req: any, @Query() query: any) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.reportByCategory(query, storeId);
  }

  @Get('reports/by-employee')
  reportByEmployee(@Req() req: any, @Query() query: any) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.reportByEmployee(query, storeId);
  }

  @Get('reports/by-payment-type')
  reportByPaymentType(@Req() req: any, @Query() query: any) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.reportByPaymentType(query, storeId);
  }

  @Get('reports/receipts')
  reportReceipts(@Req() req: any, @Query() query: any) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.reportReceipts(query, storeId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Query() query: any, @Param('id') id: string) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.findOne(id, storeId);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Query() query: any,
    @Param('id') id: string,
    @Body() dto: UpdateSaleDto,
  ) {
    const storeId = normalizeStoreIdQuery(query) ?? req?.user?.storeId;
    return this.salesService.update(id, dto, storeId);
  }
}
