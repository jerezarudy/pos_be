import { SalesService } from './sales.service';
import { SaleTransactionType } from './schemas/sale.schema';

describe('SalesService', () => {
  let service: SalesService;
  let saleModel: any;
  let usersService: any;
  let itemsService: any;

  beforeEach(() => {
    saleModel = {
      exists: jest.fn(),
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

  it('preserves split payment details when creating a sale', async () => {
    const splitPayment = {
      type: 'split',
      cashReceived: 700,
      payments: [
        { type: 'cash', amount: 500, cashReceived: 700 },
        { type: 'gcash', amount: 300, referenceNo: 'GC-1' },
      ],
    };
    const createdDoc = { _id: 'sale-1' };

    jest.spyOn(service as any, 'supportsTransactions').mockResolvedValue(false);
    jest
      .spyOn(service as any, 'nextReceiptNumber')
      .mockResolvedValue('20260319000001');

    saleModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    saleModel.create.mockResolvedValue(createdDoc);

    const result = await service.create(
      {
        id: 'pos-1',
        items: [{ itemId: 'item-1', qty: 1 }],
        payment: splitPayment,
        totals: { amountDue: 800, amountPaid: 1000, change: 200 },
      },
      { storeId: 'store-1', sub: 'user-1', email: 'cashier@example.com' },
    );

    expect(saleModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: splitPayment,
      }),
    );
    expect(result).toBe(createdDoc);
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

    jest.spyOn(service as any, 'supportsTransactions').mockResolvedValue(false);
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
              payment: { type: 'cash', cashReceived: 1000 },
              items: [{ itemId: 'item-1', qty: 2, name: 'Black Magic' }],
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
      paymentType: 'cash',
      total: 1000,
      currency: 'PHP',
      items: [{ itemId: 'item-1', qty: 2, name: 'Black Magic' }],
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

  it('returns split payment details in receipt reports', async () => {
    saleModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          data: [
            {
              _id: 'sale-1',
              createdAt: new Date('2026-06-03T05:20:24.724Z'),
              currency: 'PHP',
              transactionType: SaleTransactionType.Sale,
              cashier: { name: 'Cashier 1' },
              payment: {
                type: 'split',
                payments: [
                  { type: 'cash', amount: 60, cashReceived: 100 },
                  { type: 'gcash', amount: 40 },
                ],
              },
              items: [{ itemId: 'item-1', qty: 1, name: 'Item 1' }],
              totals: { amountDue: 100 },
              receiptNo: '20260603000003',
            },
          ],
          total: [{ count: 1 }],
          sales: [{ count: 1 }],
          refunds: [{ count: 0 }],
        },
      ]),
    });

    const result = await service.reportReceipts(
      { from: '2026-06-03', to: '2026-06-03' },
      'store-1',
    );

    expect(result.data[0]).toMatchObject({
      id: 'sale-1',
      receiptNo: '20260603000003',
      type: 'Sale',
      paymentType: 'split',
      paymentDetails: [
        { type: 'cash', amount: 60, cashReceived: 100 },
        { type: 'gcash', amount: 40 },
      ],
      total: 100,
      currency: 'PHP',
    });
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
        exec: jest
          .fn()
          .mockResolvedValue([
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

  it('expands split payments in payment type reports', async () => {
    saleModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          paymentType: 'cash',
          paymentTransactions: 1,
          paymentAmount: 500,
          refundTransactions: 0,
          refundAmount: 0,
          netAmount: 500,
        },
        {
          paymentType: 'gcash',
          paymentTransactions: 1,
          paymentAmount: 300,
          refundTransactions: 0,
          refundAmount: 0,
          netAmount: 300,
        },
      ]),
    });

    const result = await service.reportByPaymentType(
      { startDate: '2026-03-19', endDate: '2026-03-19' },
      'store-1',
    );

    expect(result.data).toEqual([
      {
        paymentType: 'cash',
        paymentTransactions: 1,
        paymentAmount: 500,
        refundTransactions: 0,
        refundAmount: 0,
        netAmount: 500,
      },
      {
        paymentType: 'gcash',
        paymentTransactions: 1,
        paymentAmount: 300,
        refundTransactions: 0,
        refundAmount: 0,
        netAmount: 300,
      },
    ]);

    const pipeline = saleModel.aggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ $unwind: '$__paymentEntries' }),
        expect.objectContaining({
          $group: expect.objectContaining({
            _id: '$__paymentEntries.type',
          }),
        }),
      ]),
    );
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
          payments: [
            {
              type: 'cash',
              sales: 5000,
              refunds: 500,
              net: 4500,
              transactions: 2,
              refundTransactions: 1,
              cashReceived: 5250,
              changeGiven: 250,
              cashCollected: 4500,
            },
            {
              type: 'gcash',
              sales: 2240,
              refunds: 0,
              net: 2240,
              transactions: 1,
              refundTransactions: 0,
            },
          ],
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
      payments: [
        {
          type: 'cash',
          sales: 5000,
          refunds: 500,
          net: 4500,
          transactions: 2,
          refundTransactions: 1,
          cashReceived: 5250,
          changeGiven: 250,
          cashCollected: 4500,
        },
        {
          type: 'gcash',
          sales: 2240,
          refunds: 0,
          net: 2240,
          transactions: 1,
          refundTransactions: 0,
        },
      ],
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
            payments: expect.any(Array),
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

  it('builds a sales summary for the selected and previous date ranges', async () => {
    saleModel.aggregate
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([
          {
            totals: [
              {
                currency: 'PHP',
                grossSales: 1000,
                refunds: 100,
                discounts: 50,
                netSales: 850,
                salesTransactions: 2,
                refundTransactions: 1,
                receipts: 3,
              },
            ],
            costOfGoods: [{ costOfGoods: 400 }],
            series: [
              {
                x: '2026-03-19',
                grossSales: 1000,
                refunds: 100,
                discounts: 50,
                netSales: 850,
                salesTransactions: 2,
                refundTransactions: 1,
                receipts: 3,
              },
            ],
            seriesCostOfGoods: [{ x: '2026-03-19', costOfGoods: 400 }],
          },
        ]),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([
          {
            totals: [
              {
                currency: 'PHP',
                grossSales: 500,
                refunds: 0,
                discounts: 25,
                netSales: 475,
                salesTransactions: 1,
                refundTransactions: 0,
                receipts: 1,
              },
            ],
            costOfGoods: [{ costOfGoods: 200 }],
            series: [
              {
                x: '2026-03-18',
                grossSales: 500,
                refunds: 0,
                discounts: 25,
                netSales: 475,
                salesTransactions: 1,
                refundTransactions: 0,
                receipts: 1,
              },
            ],
            seriesCostOfGoods: [{ x: '2026-03-18', costOfGoods: 200 }],
          },
        ]),
      });

    const result = await service.reportSummary(
      { startDate: '2026-03-19', endDate: '2026-03-19' },
      'store-1',
    );

    expect(result).toMatchObject({
      from: '2026-03-19T00:00:00.000Z',
      to: '2026-03-19T23:59:59.999Z',
      previousFrom: '2026-03-18T00:00:00.000Z',
      previousTo: '2026-03-18T23:59:59.999Z',
      currency: 'PHP',
      bucket: 'day',
      current: {
        totals: {
          grossSales: 1000,
          refunds: 100,
          discounts: 50,
          netSales: 850,
          costOfGoods: 400,
          grossProfit: 450,
          salesTransactions: 2,
          refundTransactions: 1,
          receipts: 3,
          averageSale: 425,
        },
        series: [
          {
            x: '2026-03-19',
            grossSales: 1000,
            refunds: 100,
            discounts: 50,
            netSales: 850,
            costOfGoods: 400,
            grossProfit: 450,
            salesTransactions: 2,
            refundTransactions: 1,
            receipts: 3,
          },
        ],
      },
      previous: {
        totals: {
          grossSales: 500,
          refunds: 0,
          discounts: 25,
          netSales: 475,
          costOfGoods: 200,
          grossProfit: 275,
          salesTransactions: 1,
          refundTransactions: 0,
          receipts: 1,
          averageSale: 475,
        },
      },
    });

    expect(saleModel.aggregate).toHaveBeenCalledTimes(2);

    const currentPipeline = saleModel.aggregate.mock.calls[0][0];
    const previousPipeline = saleModel.aggregate.mock.calls[1][0];

    expect(currentPipeline[0]).toEqual({
      $match: {
        storeId: 'store-1',
        createdAt: {
          $gte: new Date('2026-03-19T00:00:00.000Z'),
          $lte: new Date('2026-03-19T23:59:59.999Z'),
        },
      },
    });
    expect(previousPipeline[0]).toEqual({
      $match: {
        storeId: 'store-1',
        createdAt: {
          $gte: new Date('2026-03-18T00:00:00.000Z'),
          $lte: new Date('2026-03-18T23:59:59.999Z'),
        },
      },
    });
    expect(currentPipeline[1].$facet).toEqual(
      expect.objectContaining({
        totals: expect.any(Array),
        costOfGoods: expect.any(Array),
        series: expect.any(Array),
        seriesCostOfGoods: expect.any(Array),
      }),
    );
  });

  it('builds a monthly sales report for the selected month', async () => {
    saleModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          totals: [
            {
              currency: 'PHP',
              grossSales: 3143724,
              refunds: 0,
              discounts: 56640,
              netSales: 3087084,
              salesTransactions: 48,
              refundTransactions: 0,
              receipts: 48,
            },
          ],
          costOfGoods: [{ costOfGoods: 1785960 }],
          series: [
            {
              x: '2026-04-07',
              grossSales: 62400,
              refunds: 0,
              discounts: 1200,
              netSales: 61200,
              salesTransactions: 1,
              refundTransactions: 0,
              receipts: 1,
            },
            {
              x: '2026-04-08',
              grossSales: 176040,
              refunds: 0,
              discounts: 5040,
              netSales: 171000,
              salesTransactions: 2,
              refundTransactions: 0,
              receipts: 2,
            },
          ],
          seriesCostOfGoods: [
            { x: '2026-04-07', costOfGoods: 34440 },
            { x: '2026-04-08', costOfGoods: 96540 },
          ],
        },
      ]),
    });

    const result = await service.reportMonthlySales(
      { month: '2026-04' },
      'store-1',
    );

    expect(result).toMatchObject({
      month: '2026-04',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-30T23:59:59.999Z',
      currency: 'PHP',
      summary: {
        grossSales: 3143724,
        refunds: 0,
        discounts: 56640,
        netSales: 3087084,
        costOfGoods: 1785960,
        grossProfit: 1301124,
        salesTransactions: 48,
        refundTransactions: 0,
        receipts: 48,
        averageSale: 64314.25,
      },
      data: [
        {
          date: '2026-04-07',
          grossSales: 62400,
          refunds: 0,
          discounts: 1200,
          netSales: 61200,
          costOfGoods: 34440,
          grossProfit: 26760,
          salesTransactions: 1,
          refundTransactions: 0,
          receipts: 1,
        },
        {
          date: '2026-04-08',
          grossSales: 176040,
          refunds: 0,
          discounts: 5040,
          netSales: 171000,
          costOfGoods: 96540,
          grossProfit: 74460,
          salesTransactions: 2,
          refundTransactions: 0,
          receipts: 2,
        },
      ],
    });

    expect(saleModel.aggregate).toHaveBeenCalledTimes(1);

    const pipeline = saleModel.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: {
        storeId: 'store-1',
        createdAt: {
          $gte: new Date('2026-04-01T00:00:00.000Z'),
          $lte: new Date('2026-04-30T23:59:59.999Z'),
        },
      },
    });
    expect(pipeline[1].$facet).toEqual(
      expect.objectContaining({
        totals: expect.any(Array),
        costOfGoods: expect.any(Array),
        series: expect.any(Array),
        seriesCostOfGoods: expect.any(Array),
      }),
    );
  });
});
