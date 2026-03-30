import { SalesService } from './sales.service';
import { SaleTransactionType } from './schemas/sale.schema';

describe('SalesService', () => {
  let service: SalesService;
  let saleModel: any;
  let usersService: any;
  let itemsService: any;

  beforeEach(() => {
    saleModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      db: {},
    };
    usersService = {
      findOne: jest.fn().mockResolvedValue({ name: 'Test Cashier' }),
      listSalesEmployees: jest.fn(),
    };
    itemsService = {
      incrementStockForSale: jest.fn().mockResolvedValue(undefined),
      decrementStockForSale: jest.fn().mockResolvedValue(undefined),
    };

    service = new SalesService(
      saleModel,
      {} as any,
      {} as any,
      usersService,
      itemsService,
    );
  });

  it('creates refunds with non-negative totals', async () => {
    const sale = {
      _id: 'sale-1',
      storeId: 'store-1',
      posId: 'pos-1',
      currency: 'PHP',
      customerId: 'customer-1',
      email: 'buyer@example.com',
      customer: { name: 'Buyer' },
      discounts: [{ name: 'Promo', amount: 10 }],
      items: [{ itemId: 'item-1', qty: 1 }],
      payment: { type: 'cash', cashReceived: 1000 },
      totals: { amountDue: 1000, amountPaid: 1000, change: 0 },
    };
    const refundDoc = { _id: 'refund-1' };

    jest
      .spyOn(service as any, 'supportsTransactions')
      .mockResolvedValue(false);
    jest
      .spyOn(service as any, 'nextReceiptNumber')
      .mockResolvedValue('20260319000001');

    saleModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(sale),
    });
    saleModel.create.mockResolvedValue(refundDoc);
    saleModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });

    const result = await service.refund(
      'sale-1',
      { reason: 'Customer returned item' },
      { sub: 'user-1', email: 'cashier@example.com' },
      'store-1',
    );

    expect(itemsService.incrementStockForSale).toHaveBeenCalledWith(
      sale.items,
      sale.storeId,
      { allowCrossStore: true },
    );
    expect(saleModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: sale.storeId,
        transactionType: SaleTransactionType.Refund,
        posId: 'pos-1-refund',
        receiptNumber: '20260319000001',
        sourceSaleId: 'sale-1',
        refundReason: 'Customer returned item',
        totals: {
          amountDue: 1000,
          amountPaid: 1000,
          change: 0,
        },
        cashier: {
          id: 'user-1',
          name: 'Test Cashier',
          email: 'cashier@example.com',
        },
      }),
    );
    expect(result).toBe(refundDoc);
  });

  it('uses the source sale receipt number for refund receipt reports', async () => {
    saleModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          data: [
            {
              _id: 'refund-1',
              createdAt: new Date('2026-03-19T05:53:37.875Z'),
              currency: 'PHP',
              transactionType: SaleTransactionType.Refund,
              cashier: { name: 'Test Cashier' },
              customer: { name: 'Buyer' },
              totals: { amountDue: 1000 },
              receiptNo: '20260319000001',
            },
          ],
          total: [{ count: 1 }],
          sales: [{ count: 0 }],
          refunds: [{ count: 1 }],
        },
      ]),
    });

    const result = await service.reportReceipts(
      { from: '2026-03-19', to: '2026-03-19', type: 'refund' },
      'store-1',
    );

    expect(result.data[0]).toMatchObject({
      id: 'refund-1',
      receiptNo: '20260319000001',
      type: 'Refund',
      total: 1000,
      currency: 'PHP',
    });

    expect(saleModel.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $lookup: expect.objectContaining({
            from: 'sales',
          }),
        }),
      ]),
    );
  });

  it('returns the source sale receipt number in refund lists', async () => {
    const refundDoc = {
      _id: 'refund-1',
      storeId: 'store-1',
      transactionType: SaleTransactionType.Refund,
      sourceSaleId: 'sale-1',
      receiptNumber: '20260319000004',
      customer: { name: 'Buyer' },
      cashier: { name: 'Test Cashier' },
      totals: { amountDue: 1000 },
      toObject: jest.fn().mockReturnValue({
        _id: 'refund-1',
        storeId: 'store-1',
        transactionType: SaleTransactionType.Refund,
        sourceSaleId: 'sale-1',
        receiptNumber: '20260319000004',
        customer: { name: 'Buyer' },
        cashier: { name: 'Test Cashier' },
        totals: { amountDue: 1000 },
      }),
    };

    saleModel.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([refundDoc]),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { _id: 'sale-1', receiptNumber: '20260319000001' },
        ]),
      });

    saleModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const result = await service.findAll(
      { page: '1', limit: '10', type: 'refund' },
      'store-1',
    );

    expect(result.data[0]).toMatchObject({
      _id: 'refund-1',
      transactionType: SaleTransactionType.Refund,
      receiptNumber: '20260319000001',
      refundReceiptNumber: '20260319000004',
      sourceSaleId: 'sale-1',
    });
  });

  it('builds an end of day cash summary from sales and refunds', async () => {
    saleModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          summary: [
            {
              currency: 'PHP',
              grossSales: 7240,
              refundAmount: 500,
              discounts: 240,
              netSales: 6740,
              salesTransactions: 3,
              refundTransactions: 1,
              receipts: 4,
              cashSales: 5000,
              cashRefunds: 500,
              cashReceived: 5250,
              changeGiven: 250,
              cashCollected: 4500,
              netCash: 4500,
            },
          ],
          costOfGoods: [{ costOfGoods: 3425 }],
        },
      ]),
    });

    const result = await service.reportEndOfDayCash(
      { startDate: '2026-03-19', endDate: '2026-03-19' },
      'store-1',
    );

    expect(result).toEqual({
      from: '2026-03-19T00:00:00.000Z',
      to: '2026-03-19T23:59:59.999Z',
      currency: 'PHP',
      summary: {
        grossSales: 7240,
        netSales: 6740,
        discounts: 240,
        refundAmount: 500,
        grossProfit: 3315,
        costOfGoods: 3425,
        salesTransactions: 3,
        refundTransactions: 1,
        receipts: 4,
      },
      cash: {
        sales: 5000,
        refunds: 500,
        net: 4500,
        cashReceived: 5250,
        changeGiven: 250,
        cashCollected: 4500,
      },
    });

    expect(saleModel.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            storeId: 'store-1',
            createdAt: {
              $gte: new Date('2026-03-19T00:00:00.000Z'),
              $lte: new Date('2026-03-19T23:59:59.999Z'),
            },
          }),
        }),
        expect.objectContaining({
          $facet: expect.objectContaining({
            summary: expect.any(Array),
            costOfGoods: expect.any(Array),
          }),
        }),
      ]),
    );

    const pipeline = saleModel.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((stage: any) => stage.$facet);
    const projectStage = facetStage.$facet.summary.find(
      (stage: any) => stage.$project,
    );
    const refundAdjustedCashFormula = {
      $subtract: [
        { $subtract: ['$cashReceived', '$changeGiven'] },
        '$cashRefunds',
      ],
    };
    const netSalesFormula = {
      $subtract: ['$grossSales', '$refundAmount'],
    };

    expect(projectStage.$project.cashCollected).toEqual(
      refundAdjustedCashFormula,
    );
    expect(projectStage.$project.netCash).toEqual(refundAdjustedCashFormula);
    expect(projectStage.$project.netSales).toEqual(netSalesFormula);
  });
});
