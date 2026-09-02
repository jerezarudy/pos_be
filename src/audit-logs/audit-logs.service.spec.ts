import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let auditLogModel: any;
  let aggregateExec: jest.Mock;

  beforeEach(() => {
    aggregateExec = jest.fn();

    auditLogModel = {
      create: jest.fn(),
      aggregate: jest.fn().mockReturnValue({
        exec: aggregateExec,
      }),
    };

    service = new AuditLogsService(auditLogModel);
  });

  it('aggregates stock audit logs with related user and item data', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: 'log-1',
            timestamp: new Date('2026-04-13T02:00:00.000Z'),
            method: 'PATCH',
            path: '/items/item-1/stock',
            params: { id: 'item-1' },
            itemId: 'item-1',
            beforeStock: 3,
            afterStock: 25,
            beforeTrackStock: false,
            afterTrackStock: true,
            body: { inStock: 25 },
            user: { _id: 'user-1', name: 'Cashier 1', role: 'cashier' },
            item: { _id: 'item-1', name: 'Cola', inStock: 25 },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = await service.findItemStockChanges({
      page: '2',
      limit: '1000',
      itemId: 'item-1',
      userId: 'user-1',
      storeId: 'store-1',
      from: '2026-04-01',
      to: '2026-04-13',
    });

    const pipeline = auditLogModel.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;
    const addFields = pipeline[1].$addFields;
    const facet = pipeline[pipeline.length - 1].$facet;

    expect(match.$and).toEqual(
      expect.arrayContaining([
        { userId: 'user-1' },
        { storeId: 'store-1' },
        {
          timestamp: {
            $gte: new Date('2026-04-01T00:00:00.000Z'),
            $lte: new Date('2026-04-13T23:59:59.999Z'),
          },
        },
      ]),
    );
    expect(match.$and[0].$or).toHaveLength(3);
    expect(addFields.itemId).toEqual({ $ifNull: ['$params.id', '$resourceId'] });
    expect(pipeline[2]).toEqual({ $match: { itemId: 'item-1' } });
    expect(facet.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'users', as: 'user' }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'items', as: 'item' }),
        }),
      ]),
    );
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          _id: 'log-1',
          itemId: 'item-1',
          stockAction: 'updated',
          beforeStock: 3,
          afterStock: 25,
          beforeTrackStock: false,
          afterTrackStock: true,
          user: { _id: 'user-1', name: 'Cashier 1', role: 'cashier' },
          item: { _id: 'item-1', name: 'Cola', inStock: 25 },
        }),
      ],
      page: 2,
      limit: 1000,
      total: 1,
      hasNext: false,
      hasPrev: true,
    });
  });

  it('uses resourceId to aggregate created items', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: 'log-2',
            timestamp: new Date('2026-04-13T03:00:00.000Z'),
            method: 'POST',
            path: '/items',
            resourceId: 'item-2',
            itemId: 'item-2',
            afterStock: 10,
            afterTrackStock: true,
            body: { trackStock: true, inStock: 10 },
            item: { _id: 'item-2', name: 'Sprite' },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = await service.findItemStockChanges();

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        itemId: 'item-2',
        stockAction: 'created',
        beforeStock: undefined,
        afterStock: 10,
        beforeTrackStock: undefined,
        afterTrackStock: true,
        item: { _id: 'item-2', name: 'Sprite' },
      }),
    );
  });

  it('aggregates deleted item audit logs and keeps the stored item name', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: 'log-3',
            timestamp: new Date('2026-04-13T04:00:00.000Z'),
            method: 'DELETE',
            path: '/items/item-3',
            resourceId: 'item-3',
            resourceName: 'Deleted Cola',
            storeId: 'store-1',
            storeName: 'Main Store',
            itemId: 'item-3',
            itemName: 'Deleted Cola',
            user: { _id: 'user-1', name: 'Admin', role: 'admin' },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = await service.findDeletedItems({
      page: '1',
      limit: '10',
      itemId: 'item-3',
      userId: 'user-1',
      from: '2026-04-01',
      to: '2026-04-13',
    });

    const pipeline = auditLogModel.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;
    const addFields = pipeline[1].$addFields;
    const facet = pipeline[pipeline.length - 1].$facet;

    expect(match.$and).toEqual(
      expect.arrayContaining([
        {
          method: 'DELETE',
          path: /^\/items\/[^/?]+(?:\?.*)?$/,
        },
        { userId: 'user-1' },
        {
          timestamp: {
            $gte: new Date('2026-04-01T00:00:00.000Z'),
            $lte: new Date('2026-04-13T23:59:59.999Z'),
          },
        },
      ]),
    );
    expect(addFields).toEqual(
      expect.objectContaining({
        itemId: { $ifNull: ['$params.id', '$resourceId'] },
        itemName: { $ifNull: ['$resourceName', '$body.name'] },
        action: 'deleted',
      }),
    );
    expect(pipeline[2]).toEqual({ $match: { itemId: 'item-3' } });
    expect(facet.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'users', as: 'user' }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'items', as: 'item' }),
        }),
      ]),
    );
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          _id: 'log-3',
          itemId: 'item-3',
          itemName: 'Deleted Cola',
          storeId: 'store-1',
          storeName: 'Main Store',
          action: 'deleted',
          user: { _id: 'user-1', name: 'Admin', role: 'admin' },
        }),
      ],
      page: 1,
      limit: 10,
      total: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('aggregates item logs for the report display fields', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: 'log-4',
            timestamp: new Date('2026-04-14T05:00:00.000Z'),
            transactionDate: new Date('2026-04-14T05:00:00.000Z'),
            method: 'DELETE',
            path: '/items/item-4',
            resourceId: 'item-4',
            resourceName: 'Deleted Water',
            itemId: 'item-4',
            itemName: 'Deleted Water',
            transactionType: 'delete',
            beforeStock: 12,
            quantity: 12,
            userId: 'user-2',
            userName: 'Manager',
            storeId: 'store-1',
            storeName: 'Main Store',
            user: { _id: 'user-2', name: 'Manager', role: 'manager' },
            item: undefined,
            store: { _id: 'store-1', name: 'Main Store' },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = await service.findItemLogs({
      page: '1',
      limit: '10',
      itemId: 'item-4',
      userId: 'user-2',
      storeId: 'store-1',
      transactionType: 'delete',
      from: '2026-04-01',
      to: '2026-04-14',
    });

    const pipeline = auditLogModel.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;
    const addFields = pipeline[1].$addFields;
    const facet = pipeline[pipeline.length - 1].$facet;

    expect(match.$and).toEqual(
      expect.arrayContaining([
        { userId: 'user-2' },
        { storeId: 'store-1' },
        {
          timestamp: {
            $gte: new Date('2026-04-01T00:00:00.000Z'),
            $lte: new Date('2026-04-14T23:59:59.999Z'),
          },
        },
      ]),
    );
    expect(match.$and[0].$or).toEqual(
      expect.arrayContaining([
        { method: 'POST', path: /^\/items(?:\?.*)?$/ },
        {
          method: { $in: ['PATCH', 'PUT'] },
          path: /^\/items\/[^/?]+(?:\?.*)?$/,
        },
        { method: 'PATCH', path: /^\/items\/[^/?]+\/stock(?:\?.*)?$/ },
        { method: 'DELETE', path: /^\/items\/[^/?]+(?:\?.*)?$/ },
      ]),
    );
    expect(addFields).toEqual(
      expect.objectContaining({
        itemId: { $ifNull: ['$params.id', '$resourceId'] },
        transactionDate: '$timestamp',
        itemName: { $ifNull: ['$resourceName', '$body.name'] },
      }),
    );
    expect(pipeline[2]).toEqual({ $match: { itemId: 'item-4' } });
    expect(pipeline[3]).toEqual({ $match: { transactionType: 'delete' } });
    expect(facet.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'users', as: 'user' }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'items', as: 'item' }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'stores', as: 'store' }),
        }),
      ]),
    );
    expect(result).toEqual({
      data: [
        {
          _id: 'log-4',
          itemId: 'item-4',
          itemName: 'Deleted Water',
          transactionDate: new Date('2026-04-14T05:00:00.000Z'),
          transactionType: 'delete',
          quantity: 12,
          userId: 'user-2',
          userName: 'Manager',
          user: { _id: 'user-2', name: 'Manager', role: 'manager' },
          storeId: 'store-1',
          storeName: 'Main Store',
          item: undefined,
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('uses the audit payload for edit item log quantities', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: 'log-5',
            timestamp: new Date('2026-04-14T06:00:00.000Z'),
            transactionDate: new Date('2026-04-14T06:00:00.000Z'),
            method: 'PATCH',
            path: '/items/item-5',
            resourceId: 'item-5',
            resourceName: 'Test Item',
            itemId: 'item-5',
            itemName: 'Test Item',
            transactionType: 'edit',
            body: { inStock: 25 },
            quantity: 25,
            userId: 'user-1',
            userName: 'Admin',
            user: { _id: 'user-1', name: 'Admin' },
            item: { _id: 'item-5', name: 'Test Item', inStock: 30 },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = await service.findItemLogs({ transactionType: 'edit' });
    const pipeline = auditLogModel.aggregate.mock.calls[0][0];
    const facet = pipeline[pipeline.length - 1].$facet;
    const finalAddFields = facet.data[facet.data.length - 1].$addFields;

    expect(finalAddFields.quantity.$ifNull[1].$switch).toBeUndefined();
    expect(finalAddFields.quantity.$ifNull[1].$cond).toEqual([
      { $eq: ['$transactionType', 'delete'] },
      {
        $ifNull: [
          '$beforeStock',
          {
            $ifNull: ['$body.inStock', '$body.quantity'],
          },
        ],
      },
      {
        $ifNull: ['$body.inStock', '$body.quantity'],
      },
    ]);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        transactionType: 'edit',
        quantity: 25,
      }),
    );
  });

  it('includes stock update routes as edit item logs', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: 'log-6',
            timestamp: new Date('2026-04-14T07:00:00.000Z'),
            transactionDate: new Date('2026-04-14T07:00:00.000Z'),
            method: 'PATCH',
            path: '/items/item-6/stock',
            params: { id: 'item-6' },
            itemId: 'item-6',
            itemName: 'Test Item',
            transactionType: 'edit',
            beforeStock: 27,
            afterStock: 28,
            quantity: 28,
            userId: 'user-1',
            userName: 'Admin',
            user: { _id: 'user-1', name: 'Admin' },
            item: { _id: 'item-6', name: 'Test Item', inStock: 28 },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = await service.findItemLogs({ transactionType: 'edit' });
    const pipeline = auditLogModel.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;

    expect(match.$or).toEqual(
      expect.arrayContaining([
        {
          method: 'PATCH',
          path: /^\/items\/[^/?]+\/stock(?:\?.*)?$/,
        },
      ]),
    );
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        itemId: 'item-6',
        transactionType: 'edit',
        quantity: 28,
      }),
    );
  });

  it('suppresses regular item edit logs when a matching stock edit follows', async () => {
    aggregateExec.mockResolvedValue([
      {
        data: [],
        total: [],
      },
    ]);

    await service.findItemLogs();
    const pipeline = auditLogModel.aggregate.mock.calls[0][0];
    const dedupeLookup = pipeline.find(
      (stage: any) => stage.$lookup?.as === 'supersedingStockLog',
    );
    const dedupeMatch = pipeline.find(
      (stage: any) => stage.$match?.supersedingStockLog,
    );

    expect(dedupeLookup).toEqual(
      expect.objectContaining({
        $lookup: expect.objectContaining({
          from: 'audit_logs',
          as: 'supersedingStockLog',
        }),
      }),
    );
    expect(dedupeLookup.$lookup.pipeline[0].$match).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: /^\/items\/[^/?]+\/stock(?:\?.*)?$/,
      }),
    );
    expect(dedupeMatch).toEqual({
      $match: {
        supersedingStockLog: { $eq: [] },
      },
    });
  });
});
