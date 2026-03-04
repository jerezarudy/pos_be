import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto, req?.user?.storeId);
  }

  @Get()
  findAll(@Req() req: any, @Query() query: any) {
    return this.customersService.findAll(query, req?.user?.storeId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.customersService.findOne(id, req?.user?.storeId);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, dto, req?.user?.storeId);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.customersService.remove(id, req?.user?.storeId);
  }
}

