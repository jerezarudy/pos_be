export type SalePaymentDto = {
  type?: string;
  cashReceived?: number;
};

export type SaleTotalsDto = {
  amountDue?: number;
  amountPaid?: number;
  change?: number;
};

export class CreateSaleDto {
  // Client-generated sale id (e.g. UUID) from the POS app.
  id!: string;
  currency?: string;
  customer?: any;
  customerId?: string;
  email?: string;
  discounts?: any[];
  items!: any[];
  payment?: SalePaymentDto;
  totals?: SaleTotalsDto;
}
