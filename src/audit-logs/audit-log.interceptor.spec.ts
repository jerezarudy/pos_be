import { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let auditLogsService: { create: jest.Mock };
  let itemModel: any;
  let storeModel: any;
  let userModel: any;

  beforeEach(() => {
    auditLogsService = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    itemModel = {
      findById: jest.fn(),
    };
    storeModel = {
      findById: jest.fn(),
    };
    userModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
    };

    interceptor = new AuditLogInterceptor(
      auditLogsService as any,
      itemModel,
      storeModel,
      userModel,
    );
  });

  function createHttpContext(req: any, res: any): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;
  }

  it('logs before and after stock snapshots for stock updates', async () => {
    itemModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'item-1',
            inStock: 3,
            trackStock: false,
          }),
        }),
      }),
    });

    const req = {
      method: 'PATCH',
      originalUrl: '/items/item-1/stock',
      params: { id: 'item-1' },
      body: { inStock: 25 },
      query: {},
      headers: {},
      ip: '127.0.0.1',
      user: { sub: 'user-1', role: 'admin' },
    };
    const res = { statusCode: 200 };
    const next = {
      handle: () =>
        of({
          _id: 'item-1',
          inStock: 25,
          trackStock: true,
        }),
    };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createHttpContext(req, res), next as any).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: undefined,
        itemId: undefined,
        resourceId: 'item-1',
        beforeStock: 3,
        afterStock: 25,
        beforeTrackStock: false,
        afterTrackStock: true,
      }),
    );
  });

  it('logs after stock snapshots for item creation', async () => {
    storeModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'store-1',
            name: 'Main Store',
          }),
        }),
      }),
    });

    const req = {
      method: 'POST',
      originalUrl: '/items',
      params: {},
      body: {
        name: 'Cola',
        inStock: 10,
        trackStock: true,
        storeId: 'store-1',
      },
      query: {},
      headers: {},
      ip: '127.0.0.1',
      user: { sub: 'user-1', role: 'admin' },
    };
    const res = { statusCode: 201 };
    const next = {
      handle: () =>
        of({
          _id: 'item-2',
          name: 'Cola',
          storeId: 'store-1',
          inStock: 10,
          trackStock: true,
        }),
    };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createHttpContext(req, res), next as any).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(itemModel.findById).not.toHaveBeenCalled();
    expect(auditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        itemId: 'item-2',
        itemName: 'Cola',
        resourceId: 'item-2',
        resourceName: 'Cola',
        beforeStock: undefined,
        afterStock: 10,
        beforeTrackStock: undefined,
        afterTrackStock: true,
        storeId: 'store-1',
        storeName: 'Main Store',
      }),
    );
  });

  it('uses the request body item name when create response does not expose it', async () => {
    storeModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'store-1',
            name: 'Main Store',
          }),
        }),
      }),
    });

    const req = {
      method: 'POST',
      originalUrl: '/items',
      params: {},
      body: {
        name: 'BLACK V2 POD - YKT / YAKULT',
        storeId: 'store-1',
      },
      query: {},
      headers: {},
      ip: '127.0.0.1',
      user: { sub: 'user-1', role: 'admin' },
    };
    const res = { statusCode: 201 };
    const next = {
      handle: () =>
        of({
          _id: 'item-2',
          storeId: 'store-1',
        }),
    };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createHttpContext(req, res), next as any).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        itemId: 'item-2',
        itemName: 'BLACK V2 POD - YKT / YAKULT',
        resourceName: 'BLACK V2 POD - YKT / YAKULT',
        storeName: 'Main Store',
      }),
    );
  });

  it('logs deleted item identity so details remain available after removal', async () => {
    itemModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'item-3',
            name: 'Deleted Cola',
            storeId: 'store-1',
            inStock: 8,
            trackStock: true,
          }),
        }),
      }),
    });
    storeModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'store-1',
            name: 'Main Store',
          }),
        }),
      }),
    });

    const req = {
      method: 'DELETE',
      originalUrl: '/items/item-3',
      params: { id: 'item-3' },
      body: {},
      query: {},
      headers: {},
      ip: '127.0.0.1',
      user: { sub: 'user-1', role: 'admin' },
    };
    const res = { statusCode: 200 };
    const next = {
      handle: () =>
        of({
          deleted: true,
          id: 'item-3',
        }),
    };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createHttpContext(req, res), next as any).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deleted',
        itemId: 'item-3',
        itemName: 'Deleted Cola',
        resourceId: 'item-3',
        resourceName: 'Deleted Cola',
        storeId: 'store-1',
        storeName: 'Main Store',
        beforeStock: 8,
        beforeTrackStock: true,
      }),
    );
  });
});
