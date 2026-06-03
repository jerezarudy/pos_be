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

export type SalesSummaryTotals = {
  grossSales: number;
  refunds: number;
  discounts: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
  salesTransactions: number;
  refundTransactions: number;
  receipts: number;
  averageSale: number;
};

export type SalesSummarySeriesPoint = {
  x: string;
  grossSales: number;
  refunds: number;
  discounts: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
  salesTransactions: number;
  refundTransactions: number;
  receipts: number;
};

export type SalesSummaryRange = {
  from: string;
  to: string;
  totals: SalesSummaryTotals;
  series: SalesSummarySeriesPoint[];
};

export type SalesSummaryReport = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  currency: string;
  bucket: SalesReportBucket;
  current: SalesSummaryRange;
  previous: SalesSummaryRange;
};

export type MonthlySalesRow = {
  date: string;
  grossSales: number;
  refunds: number;
  discounts: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
  salesTransactions: number;
  refundTransactions: number;
  receipts: number;
};

export type MonthlySalesReport = {
  month: string;
  from: string;
  to: string;
  currency: string;
  summary: SalesSummaryTotals;
  data: MonthlySalesRow[];
};

export type ReceiptsReportRow = {
  id: string;
  receiptNo: string;
  date: string;
  employee?: string;
  customer?: string;
  type: 'Sale' | 'Refund';
  paymentType?: string;
  paymentDetails?: {
    type: string;
    amount: number;
    cashReceived?: number;
  }[];
  total: number;
  currency: string;
  items: any[];
};

export type EndOfDayCashSummary = {
  grossSales: number;
  netSales: number;
  discounts: number;
  refundAmount: number;
  grossProfit: number;
  costOfGoods: number;
  salesTransactions: number;
  refundTransactions: number;
  receipts: number;
};

export type EndOfDayCashCashBreakdown = {
  sales: number;
  refunds: number;
  net: number;
  cashReceived: number;
  changeGiven: number;
  cashCollected: number;
};

export type EndOfDayPaymentBreakdown = {
  type: string;
  sales: number;
  refunds: number;
  net: number;
  transactions: number;
  refundTransactions: number;
  cashReceived?: number;
  changeGiven?: number;
  cashCollected?: number;
};

export type EndOfDayCashReport = {
  from: string;
  to: string;
  currency: string;
  summary: EndOfDayCashSummary;
  cash: EndOfDayCashCashBreakdown;
  payments: EndOfDayPaymentBreakdown[];
};
