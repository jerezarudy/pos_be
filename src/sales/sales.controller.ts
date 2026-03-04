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

function normalizeRole(value: unknown) {
  const raw = typeof value === 'string' ? value : '';
  return raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
}

function isAdminUser(user: any) {
  const role = normalizeRole(user?.role ?? user?.userType);
  return (
    role === 'admin' ||
    role === 'administrator' ||
    role === 'super admin' ||
    role === 'superadmin'
  );
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
    return this.salesService.findAll(query, req?.user?.storeId);
  }

  @Get('reports/by-item')
  reportByItem(@Req() req: any, @Query() query: any) {
    const storeId = isAdminUser(req?.user) ? undefined : req?.user?.storeId;
    return this.salesService.reportByItem(query, storeId);
  }

  @Get('reports/by-category')
  reportByCategory(@Req() req: any, @Query() query: any) {
    const storeId = isAdminUser(req?.user) ? undefined : req?.user?.storeId;
    return this.salesService.reportByCategory(query, storeId);
  }

  @Get('reports/by-employee')
  reportByEmployee(@Req() req: any, @Query() query: any) {
    const storeId = isAdminUser(req?.user) ? undefined : req?.user?.storeId;
    return this.salesService.reportByEmployee(query, storeId);
  }

  @Get('reports/by-payment-type')
  reportByPaymentType(@Req() req: any, @Query() query: any) {
    const storeId = isAdminUser(req?.user) ? undefined : req?.user?.storeId;
    return this.salesService.reportByPaymentType(query, storeId);
  }

  @Get('reports/receipts')
  reportReceipts(@Req() req: any, @Query() query: any) {
    const storeId = isAdminUser(req?.user) ? undefined : req?.user?.storeId;
    return this.salesService.reportReceipts(query, storeId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.salesService.findOne(id, req?.user?.storeId);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateSaleDto,
  ) {
    return this.salesService.update(id, dto, req?.user?.storeId);
  }
}
