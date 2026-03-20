import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../users/user-role.enum';
import { CreateSaleDto } from './dto/create-sale.dto';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { SalesService } from './sales.service';

function parseAllStoresFlag(query: any): boolean {
  const raw = typeof query?.allStores === 'string' ? query.allStores : '';
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function parseStoreScope(query: any): {
  storeId?: string;
  storeIdProvided: boolean;
  allStoresRequested: boolean;
} {
  const storeIdProvided = Object.prototype.hasOwnProperty.call(
    query ?? {},
    'storeId',
  );

  const raw = typeof query?.storeId === 'string' ? query.storeId : '';
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();

  const allStoresRequested =
    parseAllStoresFlag(query) ||
    (storeIdProvided && (trimmed === '' || lowered === 'all'));

  const storeId =
    trimmed && lowered !== 'all'
      ? trimmed
      : allStoresRequested
        ? undefined
        : undefined;

  return { storeId, storeIdProvided, allStoresRequested };
}

function resolveStoreIdForRequest(query: any, user: any): string | undefined {
  const role = user?.role as UserRole | undefined;
  const isAdmin = role === UserRole.Admin;

  const { storeId, storeIdProvided, allStoresRequested } =
    parseStoreScope(query);

  const userStoreId =
    typeof user?.storeId === 'string' ? user.storeId.trim() : '';

  if (storeId) {
    if (!isAdmin && storeId !== userStoreId) {
      throw new ForbiddenException('Not allowed to access other stores');
    }
    return storeId;
  }

  if (allStoresRequested || (isAdmin && !storeIdProvided)) {
    if (!isAdmin) {
      throw new ForbiddenException('Not allowed to access all stores');
    }
    return undefined;
  }

  if (!userStoreId) {
    throw new BadRequestException('User has no assigned storeId');
  }

  return userStoreId;
}

@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateSaleDto) {
    return this.salesService.create(dto, req?.user);
  }

  @Post(':id/refund')
  refund(
    @Req() req: any,
    @Query() query: any,
    @Param('id') id: string,
    @Body() dto: RefundSaleDto,
  ) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.refund(id, dto, req?.user, storeId);
  }

  @Get('refunds')
  findRefunds(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.findAll({ ...query, type: 'refund' }, storeId);
  }

  @Get()
  findAll(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.findAll(query, storeId);
  }

  @Get('reports/by-item')
  reportByItem(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.reportByItem(query, storeId);
  }

  @Get('reports/by-category')
  reportByCategory(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.reportByCategory(query, storeId);
  }

  @Get('reports/by-employee')
  reportByEmployee(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.reportByEmployee(query, storeId);
  }

  @Get('reports/by-payment-type')
  reportByPaymentType(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.reportByPaymentType(query, storeId);
  }

  @Get('reports/receipts')
  reportReceipts(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.reportReceipts(query, storeId);
  }

  @Get('reports/end-of-day-cash')
  reportEndOfDayCash(@Req() req: any, @Query() query: any) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.reportEndOfDayCash(query, storeId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Query() query: any, @Param('id') id: string) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.findOne(id, storeId);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Query() query: any,
    @Param('id') id: string,
    @Body() dto: UpdateSaleDto,
  ) {
    const storeId = resolveStoreIdForRequest(query, req?.user);
    return this.salesService.update(id, dto, storeId);
  }
}
