export type SalesReportBucket = 'day' | 'week' | 'month';

export type SalesReportQueryDto = {
  from?: string;
  to?: string;
  storeId?: string;
  employeeId?: string;
  bucket?: SalesReportBucket;
  top?: string | number;
  page?: string | number;
  limit?: string | number;
};

export type SalesByItemRow = {
  itemId?: string;
  itemName: string;
  category?: { id?: string; name?: string };
  itemsSold: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
};

export type SalesByCategoryRow = {
  category: { id?: string; name: string };
  itemsSold: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
};

export type SalesByEmployeeRow = {
  employeeId: string;
  name?: string;
  email?: string;
  grossSales: number;
  refunds: number;
  discounts: number;
  netSales: number;
  receipts: number;
  averageSale: number;
  customersSignedUp: number;
};

export type SalesByPaymentTypeRow = {
  paymentType: string;
  paymentTransactions: number;
  paymentAmount: number;
  refundTransactions: number;
  refundAmount: number;
  netAmount: number;
};

export type SalesSeriesPoint = {
  x: string;
  y: number;
};

export type SalesItemSeries = {
  itemId?: string;
  itemName: string;
  points: SalesSeriesPoint[];
};
