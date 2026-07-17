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
      limit: '5',
      itemId: 'item-1',
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
        { userId: 'user-1' },
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
      limit: 5,
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
});
