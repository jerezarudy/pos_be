import type { SalePaymentDto, SaleTotalsDto } from './create-sale.dto';

export class UpdateSaleDto {
  currency?: string;
  customer?: any;
  customerId?: string;
  email?: string;
  discounts?: any[];
  items?: any[];
  payment?: SalePaymentDto;
  totals?: SaleTotalsDto;
}
